// Notifications System

class NotificationManager {
    constructor() {
        this.notifications = [];
        this.init();
    }
    
    init() {
        // Load notifications every minute
        this.loadNotifications();
        setInterval(() => this.loadNotifications(), 60000);
    }
    
    async loadNotifications() {
        try {
            // Get today's tasks which serve as notifications
            const response = await fetch('/api/dashboard/today-tasks');
            const tasks = await response.json();
            
            const notificationList = document.getElementById('notificationList');
            const badge = document.getElementById('notificationBadge');
            
            if (tasks.length === 0) {
                notificationList.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm">Bildirishnoma yo\'q</div>';
                badge.classList.add('hidden');
                return;
            }
            
            badge.textContent = tasks.length;
            badge.classList.remove('hidden');
            
            const nowMs = Date.now();
            notificationList.innerHTML = tasks.map(task => {
                let isOverdue = false;
                if (task.dueDate) {
                    let d = new Date(task.dueDate);
                    if (task.dueTime && task.dueTime.includes(':')) {
                        const parts = task.dueTime.split(':');
                        d.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
                    }
                    isOverdue = d.getTime() < nowMs;
                }
                const link = task.dealId ? `/deals?openDealId=${task.dealId}` : '/tasks';
                const timeText = task.dueTime || '10:00';
                return `
                    <div onclick="window.location.href='${link}'" style="padding:10px 14px; border-bottom:1px solid var(--border, #e2e8f0); cursor:pointer; transition:background 0.15s;" onmouseover="this.style.background='var(--bg-secondary, #f8fafc)'" onmouseout="this.style.background='transparent'">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
                            <p style="font-weight:600; font-size:13px; color:var(--text-primary, #1e293b); margin:0; line-height:1.3;">${task.title || 'Vazifa'}</p>
                            ${isOverdue ? '<span style="font-size:10px; color:#ef4444; font-weight:800; background:rgba(239,68,68,0.1); padding:1px 5px; border-radius:4px; flex-shrink:0;">Muddati o\'tdi</span>' : '<span style="font-size:10px; color:#f59e0b; font-weight:700; background:rgba(245,158,11,0.1); padding:1px 5px; border-radius:4px; flex-shrink:0;">Bugun</span>'}
                        </div>
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px; font-size:11px; color:var(--text-secondary, #64748b);">
                            <span><i class="far fa-clock"></i> ${timeText}</span>
                            ${task.client ? `<span style="font-weight:600; color:var(--text-primary);"><i class="far fa-user"></i> ${task.client.name || ''}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Notification loading error:', error);
        }
    }

    send(title, message, type = 'info') {
        if (typeof showToast === 'function') showToast(`${title}: ${message}`, type);
    }
}

// Initialize notification manager
const notificationManager = new NotificationManager();