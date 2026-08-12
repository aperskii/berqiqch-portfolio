// SES identities.
//
// The email identity is what makes the form work today: SES will not send from
// or, while in the sandbox, to an unverified address. Verification is a link in
// an email AWS sends to that address — Terraform creates the identity, you
// click the link.
//
// The domain identity is the better long-term setup. Sending "from" a gmail.com
// address via SES fails SPF and DMARC alignment because Google's records do not
// authorise SES, so strict receivers may file it as spam. A verified berqiqch.de
// with DKIM fixes that, and needs only three CNAME records in whichever zone is
// authoritative for the domain.
//
// Creating the identity and verifying it are separate steps: Terraform mints the
// DKIM tokens immediately (see the ses_dkim_records output), but SES will not
// mark the domain verified until those CNAMEs resolve. mail_from therefore stays
// on the Gmail identity until that completes — pointing it at an unverified
// domain would make every send fail.

locals {
  verify_domain = var.ses_domain != ""

  ses_identity_arns = concat(
    [aws_sesv2_email_identity.owner.arn],
    aws_sesv2_email_identity.sender[*].arn,
    aws_sesv2_email_identity.domain[*].arn,
  )
}

resource "aws_sesv2_email_identity" "owner" {
  email_identity = var.mail_to
}

# mail_from is verified separately only when it differs from mail_to.
resource "aws_sesv2_email_identity" "sender" {
  count          = var.mail_from != var.mail_to && !local.verify_domain ? 1 : 0
  email_identity = var.mail_from
}

resource "aws_sesv2_email_identity" "domain" {
  count          = local.verify_domain ? 1 : 0
  email_identity = var.ses_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}
