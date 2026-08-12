locals {
  lambda_build_dir = "${path.module}/../build/lambda"
  lambda_zip       = "${path.module}/../build/contact-lambda.zip"
}

data "aws_caller_identity" "current" {}

# Built by `npm run build:lambda`, which bundles the SES client into a single
# file so the function does not depend on what the runtime happens to ship.
data "archive_file" "contact" {
  type        = "zip"
  source_dir  = local.lambda_build_dir
  output_path = local.lambda_zip
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "contact" {
  name               = "${var.project}-contact-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "contact_permissions" {
  statement {
    sid    = "WriteLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = ["${aws_cloudwatch_log_group.contact.arn}:*"]
  }

  statement {
    sid    = "SendMailAsVerifiedIdentity"
    effect = "Allow"

    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]

    # Any identity in this account and region, but see the condition below.
    #
    # Listing only the sender's identity ARN looks tighter and was tried first,
    # but SES evaluates SendEmail against more than the From identity: with a
    # domain-based sender it also authorised against the recipient's identity,
    # and denied the call. Since every ARN here is an identity this account
    # already owns and verified, the width costs nothing.
    resources = ["arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:identity/*"]

    # This is the real constraint: the function can only ever send as
    # var.mail_from, whatever identities happen to exist in the account.
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.mail_from]
    }
  }
}

resource "aws_iam_role_policy" "contact" {
  name   = "${var.project}-contact-lambda"
  role   = aws_iam_role.contact.id
  policy = data.aws_iam_policy_document.contact_permissions.json
}

resource "aws_cloudwatch_log_group" "contact" {
  name              = "/aws/lambda/${var.project}-contact"
  retention_in_days = 14
}

resource "aws_lambda_function" "contact" {
  function_name = "${var.project}-contact"
  role          = aws_iam_role.contact.arn

  filename         = data.archive_file.contact.output_path
  source_code_hash = data.archive_file.contact.output_base64sha256

  handler     = "index.handler"
  runtime     = "nodejs22.x"
  memory_size = 256
  timeout     = 10

  # ARM is cheaper than x86 for the same work.
  architectures = ["arm64"]

  environment {
    variables = {
      MAIL_TO   = var.mail_to
      MAIL_FROM = var.mail_from
      # Canonical origin first — it is what the browser is told when a caller is
      # not on the list. The CloudFront domain stays allowed because the site
      # remains reachable there after the custom domain is attached, and the form
      # should not break for anyone using that URL.
      ALLOWED_ORIGINS = join(",", local.allowed_origins)
      AUTO_REPLY      = tostring(var.auto_reply)
      NODE_OPTIONS    = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_iam_role_policy.contact,
    aws_cloudwatch_log_group.contact,
  ]
}
