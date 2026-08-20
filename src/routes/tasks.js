const express = require('express');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

const userSelect = { select: { id: true, fullName: true, name: true, email: true, role: true, avatar: true } };

// Ensure uploads/tasks directory exists
const uploadsDir = path.join(__dirname, '../../public/uploads/tasks');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatTaskClient(t) {
  if (!t) return null;

  if (!t.client && t.contact) {
    t.client = {
      id: t.contact.id,
      name: `${t.contact.firstName} ${t.contact.lastName || ''}`.trim(),
      phone: t.contact.phone,
      phone2: t.contact.phone2 || null,
      city: t.contact.city,
      email: t.contact.email,
      company: t.contact.company ? t.contact.company.name : null
    };
  }

  if (t.deal && !t.deal.client && t.deal.contact) {
    t.deal.client = {
      id: t.deal.contact.id,
      name: `${t.deal.contact.firstName} ${t.deal.contact.lastName || ''}`.trim(),
      phone: t.deal.contact.phone,
      phone2: t.deal.contact.phone2 || null,
      city: t.deal.contact.city,
      email: t.deal.contact.email,
      company: t.deal.contact.company ? t.deal.contact.company.name : null
    };
  }

  const finalClient = t.client || t.deal?.client || null;

  // Parse labels safely
  let labelsList = [];
  if (t.labels) {
    try {
      labelsList = typeof t.labels === 'string' ? JSON.parse(t.labels) : t.labels;
      if (!Array.isArray(labelsList)) labelsList = [];
    } catch (_) {
      labelsList = t.labels ? [t.labels] : [];
    }
  }

  // Calculate overdue status
  let isOverdue = false;
  if (!t.completed && t.dueDate) {
    const due = new Date(t.dueDate);
    if (t.dueTime) {
      const parts = t.dueTime.split(':');
      if (parts.length === 2) due.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);
    }
    isOverdue = due < new Date();
  }

  // Checklist counts
  const totalChecklist = t.checklists ? t.checklists.length : 0;
  const completedChecklist = t.checklists ? t.checklists.filter(c => c.isCompleted).length : 0;

  return {
    ...t,
    clientId: finalClient ? finalClient.id : null,
    client: finalClient,
    parsedLabels: labelsList,
    isOverdue,
    checklistProgress: {
      total: totalChecklist,
      completed: completedChecklist
    },
    commentsCount: t.comments ? t.comments.length : (t._count?.comments || 0),
    attachmentsCount: t.attachments ? t.attachments.length : (t._count?.attachments || 0)
  };
}

async function logTaskActivity(taskId, userId, action, details = null) {
  try {
    await prisma.taskActivity.create({
      data: {
        taskId,
        userId: userId || null,
        action,
        details: details || null
      }
    });
  } catch (err) {
    console.warn('[Task Activity Log Warning]', err.message);
  }
}

function broadcastTaskEvent(req, type, data) {
  const broadcast = req.app.get('broadcast');
  if (broadcast) {
    broadcast({ type, ...data });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. BOARDS API
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/tasks/boards — List all boards with columns
router.get('/boards', async (req, res) => {
  try {
    let boards = await prisma.taskBoard.findMany({
      include: {
        columns: {
          orderBy: { order: 'asc' },
          include: {
            _count: {
              select: {
                tasks: {
                  where: { isArchived: false }
                }
              }
            }
          }
        },
        labels: true,
        _count: {
          select: {
            tasks: {
              where: { isArchived: false }
            }
          }
        }
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
    });

    // If no boards exist, auto-create default board
    if (boards.length === 0) {
      const defaultBoard = await prisma.taskBoard.create({
        data: {
          name: 'Asosiy Vazifalar',
          description: 'Kompaniyaning umumiy vazifalar boardi',
          color: '#007AFF',
          icon: 'fa-clipboard-list',
          isDefault: true,
          createdById: req.userId,
          columns: {
            create: [
              { name: 'Yangi', color: '#007AFF', icon: 'fa-inbox', order: 0 },
              { name: 'Jarayonda', color: '#F59E0B', icon: 'fa-spinner', order: 1 },
              { name: 'Kutilmoqda', color: '#8B5CF6', icon: 'fa-clock', order: 2 },
              { name: 'Yakunlandi', color: '#10B981', icon: 'fa-check-circle', order: 3 }
            ]
          }
        },
        include: {
          columns: {
            orderBy: { order: 'asc' },
            include: { _count: { select: { tasks: true } } }
          },
          labels: true,
          _count: { select: { tasks: true } }
        }
      });
      boards = [defaultBoard];
    }

    res.json(boards);
  } catch (error) {
    res.status(500).json({ message: 'Boardlarni yuklashda xatolik: ' + error.message });
  }
});

// POST /api/tasks/boards — Create new board
router.post('/boards', async (req, res) => {
  try {
    const { name, description, color, icon, defaultColumns } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Board nomi majburiy' });

    const cols = (Array.isArray(defaultColumns) && defaultColumns.length > 0)
      ? defaultColumns.map((c, idx) => ({
          name: c.name || `Ustun ${idx + 1}`,
          color: c.color || '#007AFF',
          icon: c.icon || 'fa-circle',
          order: idx
        }))
      : [
          { name: 'Yangi', color: '#007AFF', icon: 'fa-inbox', order: 0 },
          { name: 'Jarayonda', color: '#F59E0B', icon: 'fa-spinner', order: 1 },
          { name: 'Kutilmoqda', color: '#8B5CF6', icon: 'fa-clock', order: 2 },
          { name: 'Yakunlandi', color: '#10B981', icon: 'fa-check-circle', order: 3 }
        ];

    const board = await prisma.taskBoard.create({
      data: {
        name: name.trim(),
        description: description || null,
        color: color || '#007AFF',
        icon: icon || 'fa-clipboard-list',
        createdById: req.userId,
        columns: { create: cols }
      },
      include: {
        columns: { orderBy: { order: 'asc' } },
        labels: true
      }
    });

    broadcastTaskEvent(req, 'task_board_created', { board });
    res.status(201).json(board);
  } catch (error) {
    res.status(500).json({ message: 'Board yaratishda xatolik: ' + error.message });
  }
});

// PATCH /api/tasks/boards/:id — Update board
router.patch('/boards/:id', async (req, res) => {
  try {
    const { name, description, color, icon } = req.body;
    const boardId = Number(req.params.id);

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (description !== undefined) data.description = description;
    if (color !== undefined) data.color = color;
    if (icon !== undefined) data.icon = icon;

    const board = await prisma.taskBoard.update({
      where: { id: boardId },
      data,
      include: { columns: { orderBy: { order: 'asc' } } }
    });

    broadcastTaskEvent(req, 'task_board_updated', { board });
    res.json(board);
  } catch (error) {
    res.status(500).json({ message: 'Boardni tahrirlashda xatolik: ' + error.message });
  }
});

// DELETE /api/tasks/boards/:id — Delete board
router.delete('/boards/:id', async (req, res) => {
  try {
    const boardId = Number(req.params.id);
    const board = await prisma.taskBoard.findUnique({ where: { id: boardId } });
    if (!board) return res.status(404).json({ message: 'Board topilmadi' });
    if (board.isDefault) return res.status(400).json({ message: 'Asosiy boardni o\'chirish mumkin emas' });

    await prisma.taskBoard.delete({ where: { id: boardId } });
    broadcastTaskEvent(req, 'task_board_deleted', { boardId });
    res.json({ message: 'Board o\'chirildi' });
  } catch (error) {
    res.status(500).json({ message: 'Boardni o\'chirishda xatolik: ' + error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. COLUMNS API
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/tasks/columns — Create column in board
router.post('/columns', async (req, res) => {
  try {
    const { boardId, name, color, icon } = req.body;
    if (!boardId || !name) return res.status(400).json({ message: 'Board ID va ustun nomi majburiy' });

    const maxOrderCol = await prisma.taskColumn.findFirst({
      where: { boardId: Number(boardId) },
      orderBy: { order: 'desc' }
    });
    const nextOrder = maxOrderCol ? maxOrderCol.order + 1 : 0;

    const column = await prisma.taskColumn.create({
      data: {
        boardId: Number(boardId),
        name: name.trim(),
        color: color || '#007AFF',
        icon: icon || 'fa-circle',
        order: nextOrder
      }
    });

    broadcastTaskEvent(req, 'task_column_created', { column });
    res.status(201).json(column);
  } catch (error) {
    res.status(500).json({ message: 'Ustun yaratishda xatolik: ' + error.message });
  }
});

// PATCH /api/tasks/columns/:id — Update column
router.patch('/columns/:id', async (req, res) => {
  try {
    const { name, color, icon, order } = req.body;
    const colId = Number(req.params.id);

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (color !== undefined) data.color = color;
    if (icon !== undefined) data.icon = icon;
    if (order !== undefined) data.order = Number(order);

    const column = await prisma.taskColumn.update({
      where: { id: colId },
      data
    });

    broadcastTaskEvent(req, 'task_column_updated', { column });
    res.json(column);
  } catch (error) {
    res.status(500).json({ message: 'Ustunni tahrirlashda xatolik: ' + error.message });
  }
});

// DELETE /api/tasks/columns/:id — Delete column (with optional task relocation)
router.delete('/columns/:id', async (req, res) => {
  try {
    const colId = Number(req.params.id);
    const { targetColumnId } = req.body;

    const col = await prisma.taskColumn.findUnique({
      where: { id: colId },
      include: { _count: { select: { tasks: true } } }
    });
    if (!col) return res.status(404).json({ message: 'Ustun topilmadi' });

    if (col._count.tasks > 0 && targetColumnId) {
      // Relocate tasks to another column
      await prisma.task.updateMany({
        where: { columnId: colId },
        data: { columnId: Number(targetColumnId) }
      });
    }

    await prisma.taskColumn.delete({ where: { id: colId } });
    broadcastTaskEvent(req, 'task_column_deleted', { columnId: colId, boardId: col.boardId });
    res.json({ message: 'Ustun o\'chirildi' });
  } catch (error) {
    res.status(500).json({ message: 'Ustunni o\'chirishda xatolik: ' + error.message });
  }
});

// POST /api/tasks/columns/reorder — Reorder columns
router.post('/columns/reorder', async (req, res) => {
  try {
    const { columnOrders } = req.body; // Array of { id, order }
    if (!Array.isArray(columnOrders)) return res.status(400).json({ message: 'columnOrders massiv bo\'lishi shart' });

    for (const item of columnOrders) {
      if (item.id !== undefined && item.order !== undefined) {
        await prisma.taskColumn.update({
          where: { id: Number(item.id) },
          data: { order: Number(item.order) }
        }).catch(() => {});
      }
    }

    broadcastTaskEvent(req, 'task_columns_reordered', { columnOrders });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Ustunlar tartibini saqlashda xatolik: ' + error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. TASKS CRUD & KANBAN API
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/tasks — List tasks with comprehensive filtering
router.get('/', async (req, res) => {
  try {
    const {
      boardId,
      columnId,
      completed,
      priority,
      dealId,
      clientId,
      assignedToId,
      mine,
      isArchived,
      search,
      label,
      overdue
    } = req.query;

    const isAdmin = req.user && req.user.role === 'admin';
    const isManager = req.user && req.user.role === 'manager';

    const where = {};

    // Permission filter
    if (!isAdmin && !isManager) {
      // Operators see tasks assigned to them or their deals
      where.OR = [
        { assignedToId: req.userId },
        { createdById: req.userId },
        { deal: { managerId: req.userId } }
      ];
    } else if (mine === 'true') {
      where.assignedToId = req.userId;
    }

    if (boardId) where.boardId = Number(boardId);
    if (columnId) where.columnId = Number(columnId);
    if (priority) where.priority = priority;
    if (dealId) where.dealId = Number(dealId);
    if (clientId) where.clientId = Number(clientId);
    if (assignedToId) where.assignedToId = Number(assignedToId);
    if (isArchived !== undefined) where.isArchived = isArchived === 'true';
    else where.isArchived = false;

    if (completed !== undefined) {
      where.completed = completed === 'true';
    }

    if (overdue === 'true') {
      where.completed = false;
      where.dueDate = { lt: new Date() };
    }

    if (label) {
      where.labels = { contains: label };
    }

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q } },
        { description: { contains: q } },
        { client: { name: { contains: q } } },
        { client: { phone: { contains: q } } },
        { deal: { productName: { contains: q } } }
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: userSelect,
        createdBy: userSelect,
        column: { select: { id: true, name: true, color: true, icon: true, order: true } },
        checklists: { orderBy: { order: 'asc' } },
        comments: {
          select: { id: true }
        },
        attachments: {
          select: { id: true }
        },
        client: {
          select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          select: {
            id: true,
            productName: true,
            amount: true,
            status: true,
            pipelineId: true,
            stageId: true,
            stage: { select: { id: true, name: true, color: true } },
            client: {
              select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      },
      orderBy: [
        { order: 'asc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    res.json(tasks.map(formatTaskClient));
  } catch (error) {
    res.status(500).json({ message: 'Vazifalarni yuklashda xatolik: ' + error.message });
  }
});

// GET /api/tasks/:id — Get full task detail
router.get('/:id', async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignedTo: userSelect,
        createdBy: userSelect,
        board: { select: { id: true, name: true, color: true } },
        column: { select: { id: true, name: true, color: true, icon: true } },
        checklists: { orderBy: [{ order: 'asc' }, { id: 'asc' }] },
        comments: {
          include: { user: userSelect },
          orderBy: { createdAt: 'asc' }
        },
        attachments: {
          include: { uploadedBy: userSelect },
          orderBy: { createdAt: 'desc' }
        },
        activities: {
          include: { user: userSelect },
          orderBy: { createdAt: 'desc' },
          take: 25
        },
        client: {
          select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          include: {
            stage: { select: { id: true, name: true, color: true } },
            client: {
              select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      }
    });

    if (!task) return res.status(404).json({ message: 'Vazifa topilmadi' });
    res.json(formatTaskClient(task));
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks — Create task
router.post('/', async (req, res, next) => {
  try {
    const {
      title,
      description,
      boardId,
      columnId,
      dueDate,
      dueTime,
      dealId,
      clientId,
      contactId,
      assignedToId,
      priority,
      actionType,
      labels,
      reminderMinutes
    } = req.body;

    if (!title || !title.trim()) return res.status(400).json({ message: 'Vazifa sarlavhasi majburiy' });

    // Determine board and column
    let finalBoardId = boardId ? Number(boardId) : null;
    let finalColumnId = columnId ? Number(columnId) : null;

    if (!finalBoardId) {
      const defaultBoard = await prisma.taskBoard.findFirst({ where: { isDefault: true }, include: { columns: { orderBy: { order: 'asc' } } } })
        || await prisma.taskBoard.findFirst({ include: { columns: { orderBy: { order: 'asc' } } } });
      if (defaultBoard) {
        finalBoardId = defaultBoard.id;
        if (!finalColumnId && defaultBoard.columns.length > 0) {
          finalColumnId = defaultBoard.columns[0].id;
        }
      }
    } else if (!finalColumnId) {
      const firstCol = await prisma.taskColumn.findFirst({ where: { boardId: finalBoardId }, orderBy: { order: 'asc' } });
      if (firstCol) finalColumnId = firstCol.id;
    }

    // Determine position/order at bottom of column
    let nextOrder = 0;
    if (finalColumnId) {
      const maxOrder = await prisma.task.findFirst({
        where: { columnId: finalColumnId },
        orderBy: { order: 'desc' },
        select: { order: true }
      });
      nextOrder = maxOrder ? maxOrder.order + 1 : 0;
    }

    // Format labels as JSON string
    let labelsStr = null;
    if (labels) {
      labelsStr = typeof labels === 'string' ? labels : JSON.stringify(labels);
    }

    const task = await prisma.task.create({
      data: {
        title: title.trim(),
        description: description || null,
        boardId: finalBoardId,
        columnId: finalColumnId,
        order: nextOrder,
        priority: priority || 'medium',
        actionType: actionType || 'Aloqaga chiqish',
        dueDate: (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null,
        dueTime: dueTime || null,
        reminderMinutes: reminderMinutes ? Number(reminderMinutes) : null,
        labels: labelsStr,
        dealId: dealId ? Number(dealId) : null,
        clientId: clientId ? Number(clientId) : null,
        contactId: contactId ? Number(contactId) : null,
        assignedToId: assignedToId ? Number(assignedToId) : (typeof req.userId === 'number' ? req.userId : null),
        createdById: req.userId
      },
      include: {
        assignedTo: userSelect,
        createdBy: userSelect,
        column: { select: { id: true, name: true, color: true, icon: true } },
        checklists: true,
        client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
        deal: {
          select: {
            id: true,
            productName: true,
            client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } }
          }
        }
      }
    });

    // Log Activity
    await logTaskActivity(task.id, req.userId, "Vazifa yaratildi", `"${task.title}" yaratildi`);

    // Broadcast Realtime Event
    broadcastTaskEvent(req, 'task_created', { taskId: task.id, task: formatTaskClient(task) });

    res.status(201).json(formatTaskClient(task));
  } catch (error) {
    next(error);
  }
});

// PATCH /api/tasks/:id — Update task details
router.patch('/:id', async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const {
      title,
      description,
      boardId,
      columnId,
      dueDate,
      dueTime,
      dealId,
      clientId,
      contactId,
      assignedToId,
      priority,
      completed,
      actionType,
      result,
      labels,
      reminderMinutes,
      isArchived
    } = req.body;

    const oldTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: { column: true, assignedTo: true }
    });
    if (!oldTask) return res.status(404).json({ message: 'Vazifa topilmadi' });

    const data = {};
    const activityLogs = [];

    if (title !== undefined && title.trim() !== oldTask.title) {
      data.title = title.trim();
      activityLogs.push(`Sarlavha o'zgartirildi: "${data.title}"`);
    }
    if (description !== undefined) data.description = description;
    if (boardId !== undefined) data.boardId = boardId ? Number(boardId) : null;
    if (columnId !== undefined) data.columnId = columnId ? Number(columnId) : null;

    if (dueDate !== undefined) {
      data.dueDate = (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null;
      activityLogs.push(`Muddat yangilandi: ${data.dueDate ? data.dueDate.toISOString().slice(0,10) : 'Olib tashlandi'}`);
    }
    if (dueTime !== undefined) data.dueTime = dueTime;
    if (reminderMinutes !== undefined) data.reminderMinutes = reminderMinutes ? Number(reminderMinutes) : null;

    if (priority !== undefined && priority !== oldTask.priority) {
      data.priority = priority;
      activityLogs.push(`Muhimlik darajasi: ${oldTask.priority} → ${priority}`);
    }

    if (actionType !== undefined) data.actionType = actionType;
    if (result !== undefined) data.result = result;

    if (completed !== undefined) {
      data.completed = Boolean(completed);
      data.status = data.completed ? 'completed' : 'todo';
      data.completedAt = data.completed ? new Date() : null;
      activityLogs.push(data.completed ? "Vazifa bajarildi deb belgilandi" : "Vazifa qayta ochildi");
    }

    if (isArchived !== undefined) {
      data.isArchived = Boolean(isArchived);
      activityLogs.push(data.isArchived ? "Vazifa arxivlandi" : "Vazifa arxivdan chiqarildi");
    }

    if (assignedToId !== undefined && assignedToId !== oldTask.assignedToId) {
      data.assignedToId = assignedToId ? Number(assignedToId) : null;
      activityLogs.push("Mas'ul xodim o'zgartirildi");
    }

    if (dealId !== undefined) data.dealId = dealId ? Number(dealId) : null;
    if (clientId !== undefined) data.clientId = clientId ? Number(clientId) : null;
    if (contactId !== undefined) data.contactId = contactId ? Number(contactId) : null;

    if (labels !== undefined) {
      data.labels = typeof labels === 'string' ? labels : JSON.stringify(labels);
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        assignedTo: userSelect,
        createdBy: userSelect,
        board: { select: { id: true, name: true, color: true } },
        column: { select: { id: true, name: true, color: true, icon: true } },
        checklists: { orderBy: { order: 'asc' } },
        client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
        deal: {
          select: {
            id: true,
            productName: true,
            stage: { select: { id: true, name: true } },
            client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } }
          }
        }
      }
    });

    // Write activity logs
    for (const log of activityLogs) {
      await logTaskActivity(taskId, req.userId, "Vazifa yangilandi", log);
    }

    broadcastTaskEvent(req, 'task_updated', { taskId, task: formatTaskClient(updatedTask) });
    res.json(formatTaskClient(updatedTask));
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/move — Drag & drop task movement between columns and reordering
router.post('/:id/move', async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const { columnId, order, completed } = req.body;

    const oldTask = await prisma.task.findUnique({
      where: { id: taskId },
      include: { column: true }
    });
    if (!oldTask) return res.status(404).json({ message: 'Vazifa topilmadi' });

    const newColumnId = columnId ? Number(columnId) : oldTask.columnId;
    const targetCol = await prisma.taskColumn.findUnique({ where: { id: newColumnId } });

    const data = {
      columnId: newColumnId,
      order: order !== undefined ? Number(order) : oldTask.order
    };

    // If column name suggests completion (e.g. "Yakunlandi", "Bajarildi", "Done") or completed flag passed
    const isColDone = targetCol && (
      targetCol.name.toLowerCase().includes('yakun') ||
      targetCol.name.toLowerCase().includes('bajar') ||
      targetCol.name.toLowerCase().includes('done') ||
      targetCol.name.toLowerCase().includes('tugat')
    );

    if (completed !== undefined) {
      data.completed = Boolean(completed);
      data.status = data.completed ? 'completed' : 'todo';
      data.completedAt = data.completed ? new Date() : null;
    } else if (isColDone) {
      data.completed = true;
      data.status = 'completed';
      data.completedAt = new Date();
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data,
      include: {
        assignedTo: userSelect,
        column: { select: { id: true, name: true, color: true, icon: true } },
        checklists: true,
        client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } }
      }
    });

    const oldColName = oldTask.column ? oldTask.column.name : 'Boshqa';
    const newColName = targetCol ? targetCol.name : 'Boshqa';
    if (oldTask.columnId !== newColumnId) {
      await logTaskActivity(taskId, req.userId, "Ustun o'zgartirildi", `"${oldColName}" → "${newColName}"`);
    }

    broadcastTaskEvent(req, 'task_moved', {
      taskId,
      columnId: newColumnId,
      order: data.order,
      task: formatTaskClient(updatedTask)
    });

    res.json(formatTaskClient(updatedTask));
  } catch (error) {
    next(error);
  }
});

// POST /api/tasks/:id/archive — Archive / unarchive task
router.post('/:id/archive', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ message: 'Vazifa topilmadi' });

    const newArchived = !task.isArchived;
    const updated = await prisma.task.update({
      where: { id: taskId },
      data: { isArchived: newArchived }
    });

    await logTaskActivity(taskId, req.userId, newArchived ? "Vazifa arxivlandi" : "Vazifa arxivdan qaytarildi");
    broadcastTaskEvent(req, 'task_archived', { taskId, isArchived: newArchived });

    res.json({ ok: true, isArchived: newArchived });
  } catch (error) {
    res.status(500).json({ message: 'Vazifani arxivlashda xatolik: ' + error.message });
  }
});

// DELETE /api/tasks/:id — Permanent delete task
router.delete('/:id', async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return res.status(404).json({ message: 'Vazifa topilmadi' });

    await prisma.task.delete({ where: { id: taskId } });
    broadcastTaskEvent(req, 'task_deleted', { taskId });

    res.json({ message: "Vazifa o'chirildi", taskId });
  } catch (error) {
    next(error);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. CHECKLIST API
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/tasks/:id/checklist — Add checklist item
router.post('/:id/checklist', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { title } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ message: 'Checklist bandi matni majburiy' });

    const maxOrder = await prisma.taskChecklistItem.findFirst({
      where: { taskId },
      orderBy: { order: 'desc' }
    });
    const nextOrder = maxOrder ? maxOrder.order + 1 : 0;

    const item = await prisma.taskChecklistItem.create({
      data: {
        taskId,
        title: title.trim(),
        order: nextOrder
      }
    });

    await logTaskActivity(taskId, req.userId, "Checklist qo'shildi", `"${item.title}"`);
    broadcastTaskEvent(req, 'task_checklist_updated', { taskId });
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: 'Checklist qo\'shishda xatolik: ' + error.message });
  }
});

// PATCH /api/tasks/:id/checklist/:itemId — Toggle / update checklist item
router.patch('/:id/checklist/:itemId', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const { isCompleted, title, order } = req.body;

    const data = {};
    if (isCompleted !== undefined) data.isCompleted = Boolean(isCompleted);
    if (title !== undefined) data.title = title.trim();
    if (order !== undefined) data.order = Number(order);

    const item = await prisma.taskChecklistItem.update({
      where: { id: itemId },
      data
    });

    broadcastTaskEvent(req, 'task_checklist_updated', { taskId });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Checklistni yangilashda xatolik: ' + error.message });
  }
});

// DELETE /api/tasks/:id/checklist/:itemId — Delete checklist item
router.delete('/:id/checklist/:itemId', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const itemId = Number(req.params.itemId);

    await prisma.taskChecklistItem.delete({ where: { id: itemId } });
    broadcastTaskEvent(req, 'task_checklist_updated', { taskId });
    res.json({ message: 'Checklist bandi o\'chirildi' });
  } catch (error) {
    res.status(500).json({ message: 'Checklistni o\'chirishda xatolik: ' + error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. COMMENTS API
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/tasks/:id/comments — Add comment
router.post('/:id/comments', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ message: 'Sharh matni majburiy' });

    const comment = await prisma.taskComment.create({
      data: {
        taskId,
        userId: req.userId,
        content: content.trim()
      },
      include: { user: userSelect }
    });

    await logTaskActivity(taskId, req.userId, "Sharh yozildi", content.slice(0, 60));
    broadcastTaskEvent(req, 'task_comment_added', { taskId, comment });
    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ message: 'Sharh qo\'shishda xatolik: ' + error.message });
  }
});

// DELETE /api/tasks/:id/comments/:commentId — Delete comment
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const commentId = Number(req.params.commentId);

    const comment = await prisma.taskComment.findUnique({ where: { id: commentId } });
    if (!comment) return res.status(404).json({ message: 'Sharh topilmadi' });

    // Only comment owner or admin can delete
    if (comment.userId !== req.userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Faqat sharh egasi yoki admin o\'chira oladi' });
    }

    await prisma.taskComment.delete({ where: { id: commentId } });
    broadcastTaskEvent(req, 'task_comment_deleted', { taskId, commentId });
    res.json({ message: 'Sharh o\'chirildi' });
  } catch (error) {
    res.status(500).json({ message: 'Sharhni o\'chirishda xatolik: ' + error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. ATTACHMENTS API (Base64 Safe Upload)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/tasks/:id/attachments — Upload file attachment (Base64)
router.post('/:id/attachments', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { fileName, fileData, fileType, fileSize } = req.body;
    if (!fileName || !fileData) return res.status(400).json({ message: 'Fayl nomi va ma\'lumotlari majburiy' });

    // Clean base64 string
    const base64Data = fileData.replace(/^data:[^;]+;base64,/, '');
    const ext = path.extname(fileName) || '.bin';
    const safeName = `task_${taskId}_${Date.now()}${ext}`;
    const filePath = path.join(uploadsDir, safeName);

    fs.writeFileSync(filePath, base64Data, 'base64');
    const fileUrl = `/uploads/tasks/${safeName}`;

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId,
        fileName: fileName.trim(),
        fileUrl,
        fileSize: fileSize ? Number(fileSize) : null,
        fileType: fileType || null,
        uploadedById: req.userId
      },
      include: { uploadedBy: userSelect }
    });

    await logTaskActivity(taskId, req.userId, "Fayl yuklandi", fileName);
    broadcastTaskEvent(req, 'task_attachment_added', { taskId, attachment });
    res.status(201).json(attachment);
  } catch (error) {
    res.status(500).json({ message: 'Fayl yuklashda xatolik: ' + error.message });
  }
});

// DELETE /api/tasks/:id/attachments/:attId — Delete attachment
router.delete('/:id/attachments/:attId', async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const attId = Number(req.params.attId);

    const att = await prisma.taskAttachment.findUnique({ where: { id: attId } });
    if (!att) return res.status(404).json({ message: 'Fayl topilmadi' });

    // Attempt file system deletion
    if (att.fileUrl) {
      const localPath = path.join(__dirname, '../../public', att.fileUrl);
      if (fs.existsSync(localPath)) {
        try { fs.unlinkSync(localPath); } catch (_) {}
      }
    }

    await prisma.taskAttachment.delete({ where: { id: attId } });
    broadcastTaskEvent(req, 'task_attachment_deleted', { taskId, attId });
    res.json({ message: 'Fayl o\'chirildi' });
  } catch (error) {
    res.status(500).json({ message: 'Faylni o\'chirishda xatolik: ' + error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. LABELS API
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/tasks/labels — List labels for board
router.get('/labels', async (req, res) => {
  try {
    const { boardId } = req.query;
    const where = boardId ? { boardId: Number(boardId) } : {};
    const labels = await prisma.taskLabel.findMany({
      where,
      orderBy: { name: 'asc' }
    });
    res.json(labels);
  } catch (error) {
    res.status(500).json({ message: 'Labellarni yuklashda xatolik: ' + error.message });
  }
});

// POST /api/tasks/labels — Create label
router.post('/labels', async (req, res) => {
  try {
    const { boardId, name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Label nomi majburiy' });

    const label = await prisma.taskLabel.create({
      data: {
        boardId: boardId ? Number(boardId) : null,
        name: name.trim(),
        color: color || '#007AFF'
      }
    });
    res.status(201).json(label);
  } catch (error) {
    res.status(500).json({ message: 'Label yaratishda xatolik: ' + error.message });
  }
});

// DELETE /api/tasks/labels/:id — Delete label
router.delete('/labels/:id', async (req, res) => {
  try {
    const labelId = Number(req.params.id);
    await prisma.taskLabel.delete({ where: { id: labelId } });
    res.json({ message: 'Label o\'chirildi' });
  } catch (error) {
    res.status(500).json({ message: 'Labelni o\'chirishda xatolik: ' + error.message });
  }
});

module.exports = router;
