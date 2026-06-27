# Desco CRM - Project Rules

The following rules were established during debugging and architecture stabilization to prevent recurring issues in this specific codebase.

## 1. EJS Template Syntax Rule
- **Issue:** We previously experienced "Syntax Error" and raw code leaks because JavaScript template literal syntax (`${var}`) was mistakenly used directly in HTML inside `.ejs` files.
- **Rule:** When generating dynamic HTML inside `.ejs` template files (outside of `<script>` blocks), **never** use ES6 template literals (`${...}`). Always strictly use EJS interpolation tags (`<%= var %>` or `<%- html %>`) and EJS control flow (`<% if() { %>`).

## 2. Deal Creation API Payload Rule
- **Issue:** Deals were successfully saving to the database but failing to show up on the Kanban board because they were missing the pipeline mapping.
- **Rule:** When modifying or writing frontend code that creates a new deal via the `POST /api/deals` endpoint, always ensure that `pipelineId` is explicitly included in the request payload. Without it, deals will be orphaned and won't render in the UI pipeline lists (like "Nasiya" or "Shopirdagi pul").

## 3. Database URL and Prisma Provider Matching
- **Issue:** We had a Prisma initialization crash because the `.env` database URL protocol didn't match the provider in `schema.prisma`.
- **Rule:** Always ensure the `provider` in `schema.prisma` aligns perfectly with the `DATABASE_URL` in `.env` (i.e., `sqlite` goes with `file:./dev.db`, and `postgresql` goes with `postgres://...`).
