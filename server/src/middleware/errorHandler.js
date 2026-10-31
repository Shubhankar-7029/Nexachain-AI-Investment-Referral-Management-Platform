module.exports = (err, req, res, _next) => {
  let status = err.statusCode || err.status || 500;
  let message = err.message;

  if (err.code === 11000) { status = 409; message = 'A record with this unique value already exists'; }
  else if (err.name === 'ValidationError' && err.errors) { status = 400; message = Object.values(err.errors).map((e) => e.message)[0] || 'Validation failed'; }
  else if (err.name === 'CastError') { status = 400; message = `Invalid value for ${err.path}`; }
  else if (err.type === 'entity.parse.failed') { status = 400; message = 'Request body is not valid JSON'; }
  else if (err.type === 'entity.too.large') { status = 413; message = 'Request body is too large'; }

  // Only unexpected errors are interesting in the logs; 4xx are normal client mistakes.
  if (status >= 500) console.error(err);
  if (status >= 500 && process.env.NODE_ENV === 'production') message = 'Internal server error';
  res.status(status).json({ message: message || 'Internal server error' });
};
