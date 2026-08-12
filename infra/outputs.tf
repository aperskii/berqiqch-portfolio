output "site_url" {
  description = "Where the site is served."
  value       = local.site_origin
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "cloudfront_distribution_id" {
  description = "Needed for cache invalidations. Set as CLOUDFRONT_DISTRIBUTION_ID in GitHub."
  value       = aws_cloudfront_distribution.site.id
}

output "s3_bucket" {
  description = "Site bucket. Set as S3_BUCKET in GitHub."
  value       = aws_s3_bucket.site.id
}

output "contact_endpoint" {
  description = "Contact form URL. Pass as CONTACT_ENDPOINT when building the site."
  value       = "${aws_apigatewayv2_api.contact.api_endpoint}/contact"
}

output "github_deploy_role_arn" {
  description = "Role for GitHub Actions to assume. Set as AWS_DEPLOY_ROLE_ARN in GitHub."
  value       = local.enable_ci ? aws_iam_role.ci[0].arn : null
}

output "ses_verification_pending" {
  description = "Identities that must be confirmed before any mail can be sent."
  value = {
    email_identity = aws_sesv2_email_identity.owner.email_identity
    verified       = aws_sesv2_email_identity.owner.verified_for_sending_status
    note           = "Check this inbox for an AWS verification link and click it."
  }
}

# Create these in whichever zone is authoritative for the domain to authenticate
# mail from it. Only populated when var.ses_domain is set.
output "ses_dkim_records" {
  description = "CNAME records to create for SES DKIM signing."
  value = local.verify_domain ? [
    for token in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens : {
      name  = "${token}._domainkey.${var.ses_domain}"
      type  = "CNAME"
      value = "${token}.dkim.amazonses.com"
    }
  ] : []
}

output "acm_validation_records" {
  description = "DNS records that must exist before the ACM certificate is issued."
  value = local.create_certificate ? [
    for option in aws_acm_certificate.site[0].domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ] : []
}

# What the site names should point at once the certificate is attached. The apex
# cannot be a CNAME, so at a registrar without ALIAS support it needs a redirect
# to the www host rather than a record of its own.
output "cloudfront_alias_target" {
  description = "CNAME target for the site's hostnames."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "custom_domain_attached" {
  description = "Whether CloudFront is currently serving domain_names."
  value       = local.attach_domain
}

output "allowed_origins" {
  description = "Origins the contact form accepts, canonical first."
  value       = local.allowed_origins
}

output "acm_certificate_arn" {
  description = "The site certificate, for checking issuance status."
  value       = local.create_certificate ? aws_acm_certificate.site[0].arn : var.acm_certificate_arn
}
