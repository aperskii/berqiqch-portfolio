// Custom domain support. Inert while var.domain_names is empty, which is the
// current state: berqiqch.de still answers on checkdomain.de nameservers. Once
// the zone is live in Route 53 the validation records can be managed here; until
// then they must be created by hand. See DEPLOY.md.

locals {
  create_certificate = local.use_custom_domain && var.acm_certificate_arn == ""

  certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : (
    local.create_certificate ? aws_acm_certificate.site[0].arn : null
  )
}

resource "aws_acm_certificate" "site" {
  count    = local.create_certificate ? 1 : 0
  provider = aws.us_east_1

  domain_name               = var.domain_names[0]
  subject_alternative_names = slice(var.domain_names, 1, length(var.domain_names))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}
