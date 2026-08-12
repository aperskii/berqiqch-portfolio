# Deployment

Static site on S3 behind CloudFront. The contact form runs on API Gateway →
Lambda → SES. There is no database and nothing is persisted.

```
Browser ──── GET ────► CloudFront ──── OAC ────► S3 (private)
   │
   └── POST /contact ─► API Gateway ─► Lambda ─► SES ─► your inbox
```

## Prerequisites

| Tool          | Version used |
| ------------- | ------------ |
| Node.js       | 20 or newer  |
| Terraform     | 1.6 or newer |
| AWS CLI       | v2           |

AWS credentials must be configured (`aws sts get-caller-identity` should
succeed). Everything lives in `eu-central-1` except the ACM certificate, which
CloudFront requires in `us-east-1`.

## 1. Build

```bash
npm ci
npm test                 # contact handler unit checks
npm run build            # site -> dist/, lambda bundle -> build/lambda/
```

Terraform zips `build/lambda/`, so **the build must run before the first
apply**. The SES client is bundled into the function rather than taken from the
runtime, so nothing breaks when AWS changes what the runtime ships.

## 2. Provision

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # edit if needed
terraform init
terraform plan -out=tfplan
terraform apply tfplan
```

This creates 22 resources: the private S3 bucket, the CloudFront distribution
with Origin Access Control and a security-headers policy, the HTTP API, the
Lambda and its scoped IAM role, two CloudWatch log groups, and the SES email
identity.

Note the outputs:

```bash
terraform output
```

## 3. Verify the SES identity

**Mail cannot be sent until this is done.** Terraform creates the identity;
confirming it is a manual step by design.

1. AWS sends a verification email to `yassine.berqiqch@gmail.com`.
2. Click the link in it (it expires after 24 hours).
3. Confirm:

```bash
aws sesv2 get-email-identity \
  --email-identity yassine.berqiqch@gmail.com \
  --region eu-central-1 \
  --query '{Verified:VerifiedForSendingStatus}'
```

If the mail never arrives, resend it:

```bash
aws sesv2 create-email-identity \
  --email-identity yassine.berqiqch@gmail.com --region eu-central-1
```

### SES sandbox

The account is currently **in the sandbox**:

```bash
aws sesv2 get-account --region eu-central-1 \
  --query '{Production:ProductionAccessEnabled,Quota:SendQuota}'
```

In the sandbox SES delivers **only to verified addresses**, at 200 messages per
day. That is fine for the form itself, because the single recipient is your own
verified address — the visitor's address only appears in `Reply-To`.

It is *not* enough for the auto-reply, which targets whatever address a visitor
typed. `auto_reply` is therefore `false` by default. To enable it, request
production access first:

```
AWS Console → Amazon SES → Account dashboard → Request production access
```

Then set `auto_reply = true` in `terraform.tfvars` and re-apply. Approval
usually takes about a day.

### Deliverability and the berqiqch.de domain identity

`ses_domain = "berqiqch.de"` is set, so Terraform creates the domain identity and
generates its DKIM tokens on apply. **Creating the identity and verifying it are
two different things**: SES will not mark the domain verified until the three
CNAME records resolve publicly.

`mail_from` therefore stays on the Gmail address for now. That works, but
`gmail.com` publishes SPF and DMARC records that do not authorise SES to send on
its behalf, so strict receivers may file the message as spam. Pointing
`mail_from` at `noreply@berqiqch.de` before the domain verifies would not improve
that — it would make **every send fail**, because SES rejects an unverified
sender outright.

To finish the switch:

1. Read the records:

   ```bash
   cd infra && terraform output -json ses_dkim_records
   ```

2. Create all three CNAMEs in whichever zone is authoritative for `berqiqch.de`.
   At the time of writing that is **checkdomain.de** (`ns.checkdomain.de`,
   `ns2.checkdomain.de`), not Route 53. The records work in either, so this does
   not have to wait for the migration — but if you are about to move the zone,
   create them in Route 53 after the move instead of twice.

3. Wait for verification, then confirm:

   ```bash
   aws sesv2 get-email-identity --email-identity berqiqch.de \
     --region eu-central-1 --query '{Verified:VerifiedForSendingStatus,DKIM:DkimAttributes.Status}'
   ```

4. Only once that reports verified, set `mail_from = "noreply@berqiqch.de"` in
   `terraform.tfvars` and apply again. The Lambda's IAM policy pins
   `ses:FromAddress`, so this is the single switch that moves sending to the
   domain.

DKIM alone satisfies DMARC alignment for this setup. If you later want a `DMARC`
policy record too, add `_dmarc.berqiqch.de TXT "v=DMARC1; p=none; rua=mailto:…"`
and tighten `p=` once you see clean reports.

## 4. Deploy the site

Build with the endpoint baked in, then upload:

```bash
cd ..
export CONTACT_ENDPOINT="$(cd infra && terraform output -raw contact_endpoint)"
npm run build:site

BUCKET="$(cd infra && terraform output -raw s3_bucket)"
DIST_ID="$(cd infra && terraform output -raw cloudfront_distribution_id)"

aws s3 sync dist/ "s3://$BUCKET/" --delete \
  --exclude "*.html" --cache-control "public,max-age=31536000,immutable"

aws s3 sync dist/ "s3://$BUCKET/" \
  --exclude "*" --include "*.html" \
  --cache-control "public,max-age=0,must-revalidate" \
  --content-type "text/html; charset=utf-8"

aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
```

If `CONTACT_ENDPOINT` is unset the site still builds — the form then tells
visitors to email directly instead of posting into the void.

## 5. End-to-end test

```bash
ENDPOINT="$(cd infra && terraform output -raw contact_endpoint)"
ORIGIN="$(cd infra && terraform output -raw site_url)"

# should return {"ok":true} and arrive in your inbox
curl -i -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Origin: $ORIGIN" \
  -d '{"name":"Test","email":"you@example.com","subject":"Test","message":"End to end check from curl."}'

# honeypot: 200 but no mail sent
curl -s -X POST "$ENDPOINT" -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
  -d '{"name":"Bot","email":"bot@example.com","message":"buy things now","company":"SpamCo"}'

# validation: 400
curl -s -X POST "$ENDPOINT" -H "Content-Type: application/json" -H "Origin: $ORIGIN" \
  -d '{"name":"","email":"nope","message":"hi"}'

# wrong origin: 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" -H "Origin: https://evil.example" \
  -d '{"name":"A","email":"a@b.co","message":"Origin check test message."}'
```

Logs, if something fails:

```bash
aws logs tail /aws/lambda/berqiqch-portfolio-contact --follow --region eu-central-1
```

## 6. CI/CD

The workflow in `.github/workflows/deploy.yml` runs tests, builds, syncs to S3
and invalidates CloudFront on every push to `main`. It authenticates with
**GitHub OIDC** — no AWS access keys are stored in GitHub.

Create the role by setting the repository in `terraform.tfvars`:

```hcl
github_repository = "aperskii/<repo-name>"
github_branch     = "main"
```

Apply, then in **GitHub → Settings → Secrets and variables → Actions** add:

| Kind     | Name                         | Value                                          |
| -------- | ---------------------------- | ---------------------------------------------- |
| Secret   | `AWS_DEPLOY_ROLE_ARN`        | `terraform output -raw github_deploy_role_arn`  |
| Secret   | `S3_BUCKET`                  | `terraform output -raw s3_bucket`               |
| Secret   | `CLOUDFRONT_DISTRIBUTION_ID` | `terraform output -raw cloudfront_distribution_id` |
| Variable | `CONTACT_ENDPOINT`           | `terraform output -raw contact_endpoint`         |

The role's trust policy is pinned to `repo:<owner>/<name>:ref:refs/heads/main`,
so no other repository or branch can assume it. Its permissions are limited to
writing objects in the site bucket and creating invalidations on the one
distribution.

If the account already has a GitHub OIDC provider, set
`create_github_oidc_provider = false` — AWS permits only one per issuer URL.

## 7. Custom domain (berqiqch.de)

**Not attached yet.** The site is served from the CloudFront `*.cloudfront.net`
name. `berqiqch.de` currently answers on **checkdomain.de** nameservers
(`ns.checkdomain.de`, `ns2.checkdomain.de`) and there is no Route 53 hosted zone
in the account. Nothing in this stack touches DNS.

`berqiqch.com` is expired and deliberately not renewed; no configuration
references it.

### Before moving the zone

Check what the current zone actually serves, and carry it over. In particular
**inspect the `MX` records** — if `berqiqch.de` receives mail, recreating those
records in Route 53 *before* repointing the nameservers is what keeps inbound
email working:

```bash
nslookup -type=MX berqiqch.de 8.8.8.8
nslookup -type=TXT berqiqch.de 8.8.8.8
nslookup -type=A berqiqch.de 8.8.8.8
```

### Once the zone is live in Route 53

1. Create the hosted zone, recreate the existing records, then repoint the
   nameservers at the registrar. Verify resolution before continuing.
2. Set `domain_names = ["berqiqch.de", "www.berqiqch.de"]` and apply. The apply
   **blocks** while ACM waits for validation — that is expected, not a hang.
3. In a second terminal, read the records ACM wants:

   ```bash
   terraform output -json acm_validation_records
   ```

4. Create them in the hosted zone. ACM issues the certificate, then the apply
   completes and CloudFront picks up the aliases.
5. Point the names at CloudFront. In Route 53 both can be **alias A/AAAA records
   targeting the distribution**, including the apex — that is the advantage over
   a registrar's DNS, where the apex cannot be a CNAME.

The site's `canonical` and `og:url` already point at `https://www.berqiqch.de/`,
so no HTML changes are needed when the domain goes live.

## Cost

At portfolio traffic this sits inside or near the AWS free tier. Rough monthly
figures for a few thousand visits:

| Service      | Cost                                          |
| ------------ | --------------------------------------------- |
| S3           | ~$0.01 (about 1.5 MB stored)                  |
| CloudFront   | $0 up to 1 TB out and 10M requests            |
| Lambda       | $0 (1M free requests/month)                   |
| API Gateway  | $1.00 per million requests                    |
| SES          | $0.10 per 1,000 emails                        |
| CloudWatch   | ~$0 at 14-day retention                       |

Expect well under $1/month. Adding a custom domain adds nothing — ACM
certificates for CloudFront are free.

## Teardown

```bash
cd infra
terraform destroy
```

S3 versioning is enabled, so if `destroy` refuses to remove a non-empty bucket:

```bash
aws s3 rm "s3://$(terraform output -raw s3_bucket)" --recursive
```

The SES identity is also removed. Re-applying means verifying the address again.
