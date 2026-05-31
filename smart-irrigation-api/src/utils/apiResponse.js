exports.success    = (res, data={}, message='OK', code=200) =>
  res.status(code).json({ success:true, message, data });
exports.created    = (res, data={}, message='Created') =>
  res.status(201).json({ success:true, message, data });
exports.paginated  = (res, items, page, limit, total) =>
  res.json({ success:true, data:items,
    pagination:{ page, limit, total, pages:Math.ceil(total/limit) } });
