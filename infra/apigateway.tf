// HTTP API in front of the contact Lambda.
//
// CORS is handled inside the function, not by the `cors_configuration` block:
// enabling both makes API Gateway and the Lambda each append their own
// Access-Control-Allow-Origin, and duplicated headers are rejected by browsers.
// Keeping it in the function also means the handler works unchanged behind a
// Lambda Function URL.

resource "aws_apigatewayv2_api" "contact" {
  name          = "${var.project}-contact"
  protocol_type = "HTTP"
  description   = "Contact form endpoint for the portfolio site"
}

resource "aws_apigatewayv2_integration" "contact" {
  api_id                 = aws_apigatewayv2_api.contact.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.contact.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

# ANY rather than separate POST/OPTIONS routes: the handler answers preflight
# itself and rejects every other method with 405.
resource "aws_apigatewayv2_route" "contact" {
  api_id    = aws_apigatewayv2_api.contact.id
  route_key = "ANY /contact"
  target    = "integrations/${aws_apigatewayv2_integration.contact.id}"
}

resource "aws_cloudwatch_log_group" "contact_api" {
  name              = "/aws/apigateway/${var.project}-contact"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "contact" {
  api_id      = aws_apigatewayv2_api.contact.id
  name        = "$default"
  auto_deploy = true

  # Throttling is the real spam brake: the honeypot stops naive bots, this caps
  # anything determined enough to fill the form repeatedly.
  default_route_settings {
    throttling_rate_limit  = var.throttle_rate_limit
    throttling_burst_limit = var.throttle_burst_limit
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.contact_api.arn

    # No request body, so no submission content reaches the logs.
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      integrationErr = "$context.integrationErrorMessage"
    })
  }
}

resource "aws_lambda_permission" "api_invoke" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.contact.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.contact.execution_arn}/*/*/contact"
}
