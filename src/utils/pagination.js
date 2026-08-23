/**
 * Pagination helper for Enterprise Querying
 */

function parsePagination(query, defaultLimit = 20, maxLimit = 100) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (isNaN(page) || page < 1) page = 1;
  if (isNaN(limit) || limit < 1) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
    take: limit
  };
}

function buildPaginationMeta(total, page, limit) {
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1
  };
}

module.exports = {
  parsePagination,
  buildPaginationMeta
};
