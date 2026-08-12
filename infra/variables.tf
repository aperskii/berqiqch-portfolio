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
    create (see the ses_dkim_records output). DNS for berqiqch.de is managed by
    hand at checkdomain, so those records are added there.
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

# --- custom domain ----------------------------------------------------------

variable "domain_names" {
  description = <<-EOT
    Names to put on the ACM certificate, most specific first. The first entry
    becomes the site's canonical origin once attached.

    Setting this only requests the certificate; it does not change CloudFront.
    Empty means no certificate at all.
  EOT
  type        = list(string)
  default     = []
}

variable "attach_custom_domain" {
  description = <<-EOT
    Attach domain_names to CloudFront as aliases and serve them on the ACM
    certificate.

    Kept separate from domain_names because DNS for berqiqch.de is managed by
    hand at checkdomain. The certificate must be requested first so its
    validation record can be read and created; only once ACM reports the
    certificate ISSUED can it be attached. Turning this on before then makes
    Terraform wait, and CloudFront reject the certificate.

    Sequence: set domain_names -> apply -> create the DNS records -> set this
    true -> apply again.
  EOT
  type        = bool
  default     = false
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

variable "github_owner_id" {
  description = <<-EOT
    Numeric GitHub account id of the repository owner.

    Some accounts issue OIDC tokens whose `sub` embeds immutable numeric ids
    rather than names:

      repo:owner@<owner_id>/name@<repo_id>:ref:refs/heads/main

    instead of the documented `repo:owner/name:ref:refs/heads/main`. A trust
    policy matching only the name form is then denied, because IAM compares the
    claim with StringEquals. Setting this and github_repository_id makes the
    role accept both spellings.

    Find them with:
      curl -s https://api.github.com/repos/<owner>/<name> | jq '.owner.id, .id'

    Leave empty to trust only the name form.
  EOT
  type        = string
  default     = ""
}

variable "github_repository_id" {
  description = "Numeric GitHub id of the repository. See github_owner_id."
  type        = string
  default     = ""
}

variable "create_github_oidc_provider" {
  description = <<-EOT
    Create the GitHub Actions OIDC provider. Set to false if the account
    already has one (only a single provider per issuer URL is allowed).
  EOT
  type        = bool
  default     = true
}
