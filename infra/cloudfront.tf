locals {
  # A certificate is wanted.
  has_domains = length(var.domain_names) > 0

  # CloudFront actually serves those names. Gated separately so the certificate
  # can be requested and validated before anything switches over.
  attach_domain = var.attach_custom_domain && local.has_domains

  cloudfront_origin = "https://${aws_cloudfront_distribution.site.domain_name}"

  # Canonical origin. Tracks what CloudFront really answers on, not what has
  # merely been requested.
  site_origin = local.attach_domain ? "https://${var.domain_names[0]}" : local.cloudfront_origin

  # Every origin the contact form may be called from, canonical first. The
  # CloudFront domain never stops working, so it stays on the list.
  allowed_origins = distinct(concat(
    [local.site_origin],
    local.attach_domain ? [for name in var.domain_names : "https://${name}"] : [],
    [local.cloudfront_origin],
  ))

  # Deliberately references execute-api by wildcard rather than the concrete API
  # id: naming the API here would make CloudFront depend on API Gateway, which
  # depends on the Lambda, which needs this distribution's domain for CORS.
  csp = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://*.execute-api.${var.region}.amazonaws.com",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ])
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.project}-oac"
  description                       = "OAC for the portfolio S3 origin"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_response_headers_policy" "site" {
  name = "${var.project}-security-headers"

  security_headers_config {
    content_security_policy {
      content_security_policy = local.csp
      override                = true
    }

    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = false
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    xss_protection {
      protection = true
      mode_block = true
      override   = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=(), payment=()"
      override = true
    }
  }
}

# HTML must revalidate so a deploy is visible immediately; the hashed-free
# asset paths are covered by the CloudFront invalidation in CI.
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project} static site"
  default_root_object = "index.html"
  price_class         = "PriceClass_100" # NA + EU; the audience is in Germany
  aliases             = local.attach_domain ? var.domain_names : []

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-${aws_s3_bucket.site.id}"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-${aws_s3_bucket.site.id}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.site.id
  }

  # With OAC, a missing key comes back from S3 as 403 rather than 404. Serve the
  # page but keep an honest status code so broken links stay visible.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/index.html"
    error_caching_min_ttl = 60
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/index.html"
    error_caching_min_ttl = 60
  }

  viewer_certificate {
    # CloudFront's default certificate only covers *.cloudfront.net, so it is
    # valid exactly while no custom domain is attached.
    cloudfront_default_certificate = local.attach_domain ? null : true

    acm_certificate_arn = local.attach_domain ? local.certificate_arn : null
    ssl_support_method  = local.attach_domain ? "sni-only" : null

    minimum_protocol_version = local.attach_domain ? "TLSv1.2_2021" : null
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
