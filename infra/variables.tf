variable "project" {
  description = "Name prefix for all resources."
  type        = string
  default     = "berqiqch-portfolio"
}

variable "region" {
  description = "Primary AWS region. Frankfurt keeps data and latency in Germany."
  type        = string
  default     = "eu-central-1"
}

# --- contact form -----------------------------------------------------------

variable "mail_to" {
  description = "Recipient of contact form submissions. Must be a verified SES identity."
  type        = string
  default     = "yassine.berqiqch@gmail.com"
}

variable "mail_from" {
  description = <<-EOT
    Sender address used by SES. Must be a verified identity.

    Defaults to the same Gmail address as mail_to, which works but fails SPF and
    DMARC alignment, so some providers may treat it as spam.

    Switch to noreply@berqiqch.de only AFTER the ses_domain identity reports
    verified. SES rejects sends from an unverified identity, so changing this
    early breaks the form rather than improving deliverability.
  EOT
  type        = string
  default     = "yassine.berqiqch@gmail.com"
}

variable "auto_reply" {
  description = <<-EOT
    Send a confirmation email back to the visitor.

    Keep this false while SES is in the sandbox: the sandbox rejects any
    recipient that is not itself verified, so an auto-reply to an arbitrary
    visitor will fail. Enable it after AWS grants production access.
  EOT
  type        = bool
  default     = false
}

variable "ses_domain" {
  description = <<-EOT
    Optional domain to verify as an SES identity, e.g. "berqiqch.de".

    Leave empty to verify only the mail_to email address. When set, Terraform
    creates the domain identity with DKIM and outputs the CNAME records to
    create (see the ses_dkim_records output). Those records work in any
    authoritative zone, so this does not depend on the Route 53 migration.
  EOT
  type        = string
  default     = ""
}

variable "throttle_rate_limit" {
  description = "Sustained requests per second allowed on the contact endpoint."
  type        = number
  default     = 2
}

variable "throttle_burst_limit" {
  description = "Burst capacity on the contact endpoint."
  type        = number
  default     = 5
}

# --- custom domain (currently unused) ---------------------------------------

variable "domain_names" {
  description = <<-EOT
    Domains to serve the site on, e.g. ["berqiqch.de", "www.berqiqch.de"].

    Empty means CloudFront serves only its own *.cloudfront.net name, which is
    the current setup. berqiqch.de still answers on checkdomain.de nameservers;
    once its zone is live in Route 53 the validation and alias records can be
    managed here. See DEPLOY.md.
  EOT
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = <<-EOT
    Existing us-east-1 ACM certificate ARN covering domain_names.

    Leave empty to have Terraform request one. A requested certificate stays
    pending until its DNS validation records exist, and CloudFront will not
    finish creating until the certificate is issued.
  EOT
  type        = string
  default     = ""
}

# --- CI/CD ------------------------------------------------------------------

variable "github_repository" {
  description = <<-EOT
    GitHub repo allowed to deploy via OIDC, as "owner/name".
    Empty skips creating the deploy role entirely.
  EOT
  type        = string
  default     = ""
}

variable "github_branch" {
  description = "Branch permitted to assume the deploy role."
  type        = string
  default     = "main"
}

variable "create_github_oidc_provider" {
  description = <<-EOT
    Create the GitHub Actions OIDC provider. Set to false if the account
    already has one (only a single provider per issuer URL is allowed).
  EOT
  type        = bool
  default     = true
}
