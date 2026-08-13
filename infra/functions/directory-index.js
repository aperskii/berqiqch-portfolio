// CloudFront Function (viewer-request), cloudfront-js-2.0.
//
// The S3 origin is a private bucket reached through OAC, not an S3 website
// endpoint, so it serves objects by exact key and has no notion of a directory
// index. The distribution's default_root_object rewrites "/" to
// "/index.html", but it only ever applies to the root — "/de/" would be
// requested as the key "de/" and come back as a 404.
//
// Appending "index.html" to any URI ending in "/" makes every directory behave
// the way "/" already does. Left alone: URIs with a file extension, and
// anything that does not end in a slash.

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  }

  return request;
}
