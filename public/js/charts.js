// Chart Configuration

// Set default Chart.js options
Chart.defaults.font.family = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
Chart.defaults.color = '#6B7280';
Chart.defaults.borderColor = '#E5E7EB';

// Custom chart color scheme
const chartColors = {
    primary: 'rgba(59, 130, 246, 0.8)',
    success: 'rgba(34, 197, 94, 0.8)',
    danger: 'rgba(239, 68, 68, 0.8)',
    warning: 'rgba(249, 115, 22, 0.8)',
    info: 'rgba(139, 92, 246, 0.8)'
};

const chartBorders = {
    primary: 'rgb(59, 130, 246)',
    success: 'rgb(34, 197, 94)',
    danger: 'rgb(239, 68, 68)',
    warning: 'rgb(249, 115, 22)',
    info: 'rgb(139, 92, 246)'
};

// Helper function to create a bar chart
function createBarChart(canvasId, labels, data, label = 'Data') {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    
    return new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: chartColors.primary,
                borderColor: chartBorders.primary,
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

// Helper function to create a line chart
function createLineChart(canvasId, labels, data, label = 'Data') {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    
    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                borderColor: chartBorders.primary,
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: chartBorders.primary,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

// Helper function to create a doughnut chart
function createDoughnutChart(canvasId, labels, data, label = 'Data') {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    
    const colors = [
        chartColors.primary,
        chartColors.success,
        chartColors.warning,
        chartColors.danger,
        chartColors.info
    ];
    
    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: colors.slice(0, labels.length),
                borderColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                }
            }
        }
    });
}