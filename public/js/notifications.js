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
            
            notificationList.innerHTML = tasks.map(task => `
                <div class="p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <p class="font-semibold text-sm text-gray-800">${task.title}</p>
                    <p class="text-xs text-gray-600 mt-1">🕐 ${task.dueTime || 'Vaqt ko\'rsatilmagan'}</p>
                </div>
            `).join('');
        } catch (error) {
            console.error('Notification loading error:', error);
        }
    }
    
    send(title, message, type = 'info') {
        showToast(`${title}: ${message}`, type);
    }
}

// Initialize notification manager
const notificationManager = new NotificationManager();