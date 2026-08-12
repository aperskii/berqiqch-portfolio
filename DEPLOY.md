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

**Done.** `ses_domain = "berqiqch.de"` is verified with DKIM `SUCCESS`, its three
CNAMEs live at checkdomain, and `mail_from = "noreply@berqiqch.de"`. Mail is
DKIM-signed and DMARC-aligned.

Worth knowing why it is set up this way, if you ever rebuild it:

- **Creating the identity and verifying it are two different things.** Terraform
  mints the DKIM tokens on apply, but SES only flips the identity to verified
  once the CNAMEs resolve publicly. Read them with
  `terraform output -json ses_dkim_records`.
- **`mail_from` must not point at the domain before it verifies.** SES rejects an
  unverified sender outright, so switching early breaks every send rather than
  improving deliverability. Sending as a `gmail.com` address works but fails SPF
  and DMARC alignment, because Google's records do not authorise SES.
- Confirm status any time:

  ```bash
  aws sesv2 get-email-identity --email-identity berqiqch.de \
    --region eu-central-1 --query '{Verified:VerifiedForSendingStatus,DKIM:DkimAttributes.Status}'
  ```

DKIM alone satisfies DMARC alignment here. To add a policy record too:
`_dmarc.berqiqch.de TXT "v=DMARC1; p=none; rua=mailto:…"`, tightening `p=` once
reports look clean.

### Why the Lambda's SES policy uses `identity/*`

The IAM statement allows `ses:SendEmail` on `identity/*` within this account and
region, constrained by a `ses:FromAddress` condition rather than by listing the
sender's identity ARN.

Narrowing `resources` to the sender identity was tried first and **fails**: with
a domain-based sender, SES also authorises against the *recipient's* identity,
producing

```
AccessDeniedException: not authorized to perform `ses:SendEmail'
on resource `…:identity/yassine.berqiqch@gmail.com'
```

Every ARN the wildcard covers is an identity this account already owns and
verified, so the width costs nothing. The `ses:FromAddress` condition is the
control that matters: the function can only ever send as `mail_from`.

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

This account **already had** a GitHub OIDC provider (AWS permits only one per
issuer URL), so `create_github_oidc_provider = false` is set and Terraform
references the existing one instead of failing with `EntityAlreadyExists`.

Apply, then in **GitHub → Settings → Secrets and variables → Actions** add the
four entries below. Mind the Secret/Variable split: the workflow reads
`CONTACT_ENDPOINT` as `vars.CONTACT_ENDPOINT`, so adding it as a Secret leaves it
empty and the build fails its own guard step.

| Kind     | Name                         | Value |
| -------- | ---------------------------- | ----- |
| Secret   | `AWS_DEPLOY_ROLE_ARN`        | `arn:aws:iam::<ACCOUNT_ID>:role/berqiqch-portfolio-github-deploy` |
| Secret   | `S3_BUCKET`                  | `<BUCKET_NAME>` |
| Secret   | `CLOUDFRONT_DISTRIBUTION_ID` | `<DISTRIBUTION_ID>` |
| Variable | `CONTACT_ENDPOINT`           | `https://<API_ID>.execute-api.eu-central-1.amazonaws.com/contact` |

Re-read them any time:

```bash
cd infra
terraform output -raw github_deploy_role_arn
terraform output -raw s3_bucket
terraform output -raw cloudfront_distribution_id
terraform output -raw contact_endpoint
```

The role's trust policy is pinned to this repository's `main` branch, so no other
repository or branch can assume it. Its permissions cover only writing objects in
the site bucket and creating invalidations on this one distribution.

### Two subject claims, not one

The trust policy accepts **both** spellings of the OIDC subject:

```
repo:aperskii/berqiqch-portfolio:ref:refs/heads/main
repo:<OWNER>@<OWNER_ID>/<REPO>@<REPO_ID>:ref:refs/heads/main
```

This account issues the second form, which embeds immutable numeric ids for the
owner and the repository. A trust policy carrying only the documented name form
is rejected outright:

```
AccessDenied: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

with everything — role ARN, audience, provider URL, `client_id_list` — otherwise
correct, which makes it a confusing failure to chase. IAM compares the claim with
`StringEquals`, so a spelling that differs at all does not match.

If it ever recurs, do not guess: CloudTrail records the exact claim presented.

```bash
aws cloudtrail lookup-events --region eu-central-1 \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 5 --query 'Events[].CloudTrailEvent' --output text \
  | python -c "import sys,json;[print(json.loads(l)['userIdentity'].get('userName'),json.loads(l).get('errorCode')) for l in sys.stdin if l.strip().startswith('{')]"
```

The `userName` field is the `sub` claim. Compare it with the trust policy and add
whatever it actually says. The numeric ids come from:

```bash
curl -s https://api.github.com/repos/aperskii/berqiqch-portfolio | jq '.owner.id, .id'
```

and are set as `github_owner_id` / `github_repository_id`. Both accepted values
name the same repository and branch, so listing two does not widen access.

## 7. Custom domain (berqiqch.de)

**DNS stays at checkdomain.** `berqiqch.de` answers on `ns.checkdomain.de` /
`ns2.checkdomain.de`, and there is deliberately no Route 53 hosted zone — every
record is added by hand in the checkdomain panel. Terraform never touches DNS.

`berqiqch.com` is expired and not renewed; no configuration references it.

Because the records are manual, attaching the domain is a **two-stage apply**,
split by `attach_custom_domain`:

| Stage | tfvars | Effect |
| ----- | ------ | ------ |
| 1 | `domain_names` set, `attach_custom_domain = false` | Certificate requested. CloudFront untouched. Validation record readable. |
| 2 | `attach_custom_domain = true` | Waits for ACM to reach ISSUED, then CloudFront serves the names. |

Doing it in one step does not work: CloudFront rejects a certificate that is
still `PENDING_VALIDATION`, and ACM cannot validate until records exist that only
you can create.

### Stage 1 — request the certificate (already applied)

```bash
terraform output -json acm_validation_records
```

### Records to create at checkdomain

Two ACM validation CNAMEs, then the host itself. Trailing dots as ACM reports
them; checkdomain may or may not want them, and may append the zone
automatically — if it does, enter only the part before `.berqiqch.de`.

| Purpose | Type | Name | Value |
| ------- | ---- | ---- | ----- |
| ACM validation (apex) | CNAME | `_<hash>.berqiqch.de.` | `_<hash>.<id>.acm-validations.aws.` |
| ACM validation (www) | CNAME | `_<hash>.www.berqiqch.de.` | `_<hash>.<id>.acm-validations.aws.` |
| Site host | CNAME | `www.berqiqch.de` | `<DISTRIBUTION_DOMAIN>.cloudfront.net` |

The two validation rows are per-certificate; take the real values from
`terraform output -json acm_validation_records` rather than from this table.

Validation CNAMEs must stay in place permanently — ACM re-checks them on
renewal, and removing them eventually breaks the certificate.

### The apex cannot be a CNAME

`berqiqch.de` on its own cannot point at CloudFront. A CNAME at a zone apex is
invalid per DNS, and CloudFront publishes no stable IP addresses to put in an A
record. Route 53 solves this with alias records; a registrar's DNS generally does
not. Options at checkdomain, best first:

1. **HTTP redirect / domain forwarding** from `berqiqch.de` to
   `https://www.berqiqch.de`. This is why `www` is first in `domain_names` and
   why the site's `canonical` is `https://www.berqiqch.de/`.
2. **An `ALIAS`/`ANAME` record**, if checkdomain offers one — then point the apex
   at `<DISTRIBUTION_DOMAIN>.cloudfront.net` directly.

The apex is on the certificate either way, so option 2 works whenever you find it
available.

### Stage 2 — attach

Once `terraform output` and `dig` agree the records resolve:

```bash
aws acm describe-certificate --region us-east-1 \
  --certificate-arn "$(terraform output -raw acm_certificate_arn 2>/dev/null || echo '')" \
  --query 'Certificate.Status'
```

Set `attach_custom_domain = true`, then:

```bash
terraform apply
```

The apply waits (up to 45 minutes) for ACM, then updates CloudFront.

`CONTACT_ENDPOINT` does not change, so the built site is byte-identical and no
rebuild is strictly required. The Lambda's `ALLOWED_ORIGINS` does change, and
Terraform updates it in the same apply.

Verify:

```bash
curl -sI https://www.berqiqch.de/ | head -3
terraform output custom_domain_attached   # expect true
terraform output -json allowed_origins
```

### Origins the form accepts

`ALLOWED_ORIGINS` is a comma-separated list, not a single value, and Terraform
populates it with the custom domain, the apex, **and** the CloudFront domain:

```
https://www.berqiqch.de,https://berqiqch.de,https://<DISTRIBUTION_DOMAIN>.cloudfront.net
```

The CloudFront domain stays on the list deliberately. Attaching a custom domain
does not stop `*.cloudfront.net` from serving the site, so dropping it would make
the form start answering 403 for anyone still using that URL — including your own
smoke tests.

The handler echoes back whichever listed origin the caller used and always sends
`Vary: Origin`, because a browser rejects a list in
`Access-Control-Allow-Origin`. Unlisted origins get the canonical origin in that
header and a 403 body. Matching is exact string equality, so
`https://www.berqiqch.de.evil.example` is not a match.

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
