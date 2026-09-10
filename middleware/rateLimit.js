function rateLimit({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();

    // Opportunistically prune expired buckets on each request.
    if (buckets.size > 1000) {
      for (const [key, bucket] of buckets) {
        if (now - bucket.start > windowMs) buckets.delete(key);
      }
    }

    const key = `${req.ip}:${req.path}`;
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
      bucket = { start: now, count: 0 };
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      return res.status(429).send('Too many attempts. Please try again later.');
    }
    next();
  };
}

module.exports = rateLimit;
