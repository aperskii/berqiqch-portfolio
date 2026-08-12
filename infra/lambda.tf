locals {
  lambda_build_dir = "${path.module}/../build/lambda"
  lambda_zip       = "${path.module}/../build/contact-lambda.zip"
}

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

    # Scoped to the identities this function is allowed to send as, so a
    # compromised function cannot send from anything else in the account.
    resources = local.ses_identity_arns

    # Belt and braces: the From address is pinned even within those identities.
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
      MAIL_TO        = var.mail_to
      MAIL_FROM      = var.mail_from
      ALLOWED_ORIGIN = local.site_origin
      AUTO_REPLY     = tostring(var.auto_reply)
      NODE_OPTIONS   = "--enable-source-maps"
    }
  }

  depends_on = [
    aws_iam_role_policy.contact,
    aws_cloudwatch_log_group.contact,
  ]
}
