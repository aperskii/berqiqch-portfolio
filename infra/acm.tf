// Custom domain support for berqiqch.de.
//
// DNS stays at checkdomain.de (ns.checkdomain.de, ns2.checkdomain.de), so every
// record is created by hand there. That splits the work into two applies:
//
//   1. domain_names set, attach_custom_domain false
//      -> certificate requested, validation record readable via
//         `terraform output acm_validation_records`. CloudFront untouched.
//   2. records created at checkdomain, certificate reaches ISSUED
//      -> attach_custom_domain true, CloudFront serves the domain.
//
// aws_acm_certificate_validation carries no validation_record_fqdns on purpose:
// the records live outside Terraform, so the resource simply waits for ACM to
// observe them. Without it CloudFront would be handed a PENDING certificate and
// the apply would fail.

locals {
  create_certificate = local.has_domains && var.acm_certificate_arn == ""

  certificate_arn = var.acm_certificate_arn != "" ? var.acm_certificate_arn : (
    length(aws_acm_certificate_validation.site) > 0
    ? aws_acm_certificate_validation.site[0].certificate_arn
    : null
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

resource "aws_acm_certificate_validation" "site" {
  count    = local.attach_domain && local.create_certificate ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.site[0].arn

  timeouts {
    create = "45m"
  }
}
