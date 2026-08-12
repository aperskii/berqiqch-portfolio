// Deploy role for GitHub Actions, assumed via OIDC. No AWS access keys are
// created or stored anywhere: Actions presents a short-lived GitHub token and
// STS exchanges it for temporary credentials.
//
// Inert until var.github_repository is set.

locals {
  enable_ci = var.github_repository != ""

  github_oidc_arn = local.enable_ci ? (
    var.create_github_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github[0].arn
  ) : null

  github_owner = split("/", var.github_repository)[0]
  github_name  = try(split("/", var.github_repository)[1], "")

  use_immutable_subject = var.github_owner_id != "" && var.github_repository_id != ""

  # Both spellings of the subject claim. This account issues the id-embedding
  # form, so matching only the documented name form is denied outright — see
  # github_owner_id for the details.
  github_subjects = concat(
    ["repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"],
    local.use_immutable_subject ? [
      "repo:${local.github_owner}@${var.github_owner_id}/${local.github_name}@${var.github_repository_id}:ref:refs/heads/${var.github_branch}"
    ] : [],
  )
}

resource "aws_iam_openid_connect_provider" "github" {
  count = local.enable_ci && var.create_github_oidc_provider ? 1 : 0

  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = local.enable_ci && !var.create_github_oidc_provider ? 1 : 0
  url   = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "ci_assume" {
  count = local.enable_ci ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Restricted to one branch of one repository. Without this condition any
    # GitHub repository on the internet could assume the role. Both accepted
    # values name that same branch, so listing two does not widen access.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_subjects
    }
  }
}

resource "aws_iam_role" "ci" {
  count = local.enable_ci ? 1 : 0

  name               = "${var.project}-github-deploy"
  description        = "Deploys the portfolio to S3 and invalidates CloudFront"
  assume_role_policy = data.aws_iam_policy_document.ci_assume[0].json
}

data "aws_iam_policy_document" "ci_permissions" {
  count = local.enable_ci ? 1 : 0

  statement {
    sid       = "ListSiteBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.site.arn]
  }

  statement {
    sid    = "WriteSiteObjects"
    effect = "Allow"

    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObject",
    ]

    resources = ["${aws_s3_bucket.site.arn}/*"]
  }

  statement {
    sid    = "InvalidateCache"
    effect = "Allow"

    actions = [
      "cloudfront:CreateInvalidation",
      # The workflow blocks on `aws cloudfront wait invalidation-completed`,
      # which polls GetInvalidation. Granting only CreateInvalidation deploys
      # the site and then fails the job on the wait.
      "cloudfront:GetInvalidation",
    ]

    resources = [aws_cloudfront_distribution.site.arn]
  }
}

resource "aws_iam_role_policy" "ci" {
  count = local.enable_ci ? 1 : 0

  name   = "${var.project}-github-deploy"
  role   = aws_iam_role.ci[0].id
  policy = data.aws_iam_policy_document.ci_permissions[0].json
}
