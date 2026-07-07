# DESCO CRM

Production-Ready CRM System for Sales & Logistics Business

## 🚀 Features

- Multi-user support with Role-Based Access Control (Admin & Manager)
- Dashboard with KPIs, Charts & Analytics
- Sales Pipeline/Funnel (Kanban Board with Premium Dark/Teal UI)
- Client Management & Contact Templates
- **[NEW]** Instagram Target Webhook Integration (Auto-Deal Generation)
- Task Management with Daily Notifications
- Expense & Logistics Tracking
- Global Search Functionality
- Audit Trails for Admin Compliance

## 📋 Tech Stack

- **Backend**: Node.js + Express.js
- **Database**: PostgreSQL (via Supabase) with Prisma ORM
- **Frontend**: EJS + Tailwind CSS + Chart.js + Custom Glassmorphism UI
- **Authentication**: JWT + Sessions
- **Security**: Webhook Tokens (`X-CRM-Webhook-Token`), Helmet, CORS, bcryptjs
- **Deployment**: Railway.app Ready

## 🛠️ Installation

### Prerequisites
- Node.js >= 16.0.0
- npm or yarn

### Setup

1. **Clone Repository**
   ```bash
   git clone https://github.com/S04devfr/Desco.crm.git
   cd Desco.crm
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Setup Environment**
   ```bash
   cp .env.example .env
   ```

4. **Database Initialization (PostgreSQL)**
   ```bash
   # Create database tables
   npx prisma db push
   
   # Note: Default data (Admin user, Default Pipelines, Stages) are automatically 
   # generated via db-migrate.js when the server starts for the first time.
   ```

5. **Start Development Server**
   ```bash
   npm run dev
   ```

   Server will run at: `http://localhost:3000`

## 🌍 Webhook for Instagram Integrations
**Endpoint:** `POST /api/webhooks/lead`
To connect Instagram Lead Generation, set up a webhook in Make.com/Zapier with the following:
- **URL**: `https://your-railway-app-url.com/api/webhooks/lead`
- **Headers**: `X-CRM-Webhook-Token: <your-WEBHOOK_SECRET_TOKEN>`
- **Body**: 
```json
{
  "name": "Mijoz Ismi",
  "phone": "+998901234567",
  "productName": "Sotib olmoqchi bo'lgan mahsulot",
  "notes": "Qo'shimcha izohlar"
}
```

## 📝 Login Credentials

**Admin Account:**
- Email: `admin@desco.com`
- Password: `Admin@123`

**Manager 1 (Abdumalik):**
- Email: `abdumalik@desco.com`
- Password: `Manager@123`

**Manager 2 (Qodirjon):**
- Email: `qodirjon@desco.com`
- Password: `Manager@123`

## 📚 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user

### Dashboard
- `GET /api/dashboard/kpis` - Get KPI metrics
- `GET /api/dashboard/sales-by-manager` - Sales analytics
- `GET /api/dashboard/product-popularity` - Product stats
- `GET /api/dashboard/today-tasks` - Today's tasks

### Deals
- `POST /api/deals` - Create deal
- `GET /api/deals` - List deals (with filters)
- `GET /api/deals/:id` - Get deal details
- `PATCH /api/deals/:id` - Update deal

### Clients
- `POST /api/clients` - Create client
- `GET /api/clients` - List clients
- `GET /api/clients/:id` - Get client details
- `PATCH /api/clients/:id` - Update client

### Expenses
- `POST /api/expenses` - Create expense
- `GET /api/expenses` - List expenses
- `GET /api/expenses/:id` - Get expense details

### Tasks
- `POST /api/tasks` - Create task
- `GET /api/tasks` - List user's tasks
- `PATCH /api/tasks/:id/complete` - Complete task

### Search
- `GET /api/search?q=term` - Global search

## 🗄️ Prisma Database Commands

```bash
# View database in GUI
npm run db:studio

# Reset database
npm run db:reset

# Run migrations
npm run db:init

# Seed sample data
npm run db:seed
```

## 📁 Project Structure

```
desco-crm/
├── src/
│   ├── config/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   └── server.js
├── prisma/
│   └── schema.prisma
├── views/
│   ├── layouts/
│   ├── dashboard/
│   ├── auth/
│   └── ...
├── public/
│   ├── css/
│   ├── js/
│   └── images/
└── package.json
```

## 🔐 Security Features

- Password hashing with bcryptjs
- JWT token authentication
- Session management
- Helmet for HTTP headers
- CORS protection
- Audit logging for admin compliance

## 📖 Documentation

Detailed documentation coming soon...

## 📄 License

ISC

## 👨‍💻 Author

DESCO Development Team
"# Desco" 
