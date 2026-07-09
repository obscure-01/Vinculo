const fs = require('fs');
let adminJs = fs.readFileSync('public/js/admin.js', 'utf8');

const viewBlockRegex = /const views = \{[\s\S]*?\/\/ Link top right dashboard header button/m;

const replacement = `
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const headerActions = document.getElementById('header-actions');
    const btnCreateTaskHeader = document.getElementById('btn-create-task-header');

    function onAdminViewEnter(title, subtitle, viewKey, fetchCallback) {
        pageTitle.textContent = title;
        pageSubtitle.textContent = subtitle;
        if (viewKey === 'createTask') {
            headerActions.classList.add('hidden');
        } else {
            headerActions.classList.remove('hidden');
        }
        if (fetchCallback) fetchCallback();
    }

    // Register Views
    ViewManager.registerView('dashboard', {
        nav: document.getElementById('nav-dashboard'),
        mobNav: document.getElementById('mobile-nav-dashboard'),
        section: document.getElementById('view-dashboard-section'),
        onEnter: () => onAdminViewEnter('Admin Dashboard', 'Overview of engagement platform activity.', 'dashboard', () => {
            fetchDashboardOverview();
            fetchRecentTasks();
        })
    });

    ViewManager.registerView('createTask', {
        nav: document.getElementById('nav-create-task'),
        mobNav: document.getElementById('mobile-nav-create-task'),
        section: document.getElementById('view-create-task-section'),
        onEnter: () => onAdminViewEnter('Create New Task', 'Publish a new engagement task.', 'createTask')
    });

    ViewManager.registerView('manageTasks', {
        nav: document.getElementById('nav-manage-tasks'),
        mobNav: document.getElementById('mobile-nav-manage-tasks'),
        section: document.getElementById('view-manage-tasks-section'),
        onEnter: () => onAdminViewEnter('Manage Tasks', 'View, edit, and deactivate existing tasks.', 'manageTasks', fetchManageTasksList)
    });

    ViewManager.registerView('analytics', {
        nav: document.getElementById('nav-analytics'),
        mobNav: document.getElementById('mobile-nav-analytics'),
        section: document.getElementById('view-analytics-section'),
        onEnter: () => onAdminViewEnter('Analytics Insights', 'Detailed institutional participation metrics.', 'analytics', fetchAnalytics)
    });

    ViewManager.registerView('students', {
        nav: document.getElementById('nav-students'),
        mobNav: document.getElementById('mobile-nav-students'),
        section: document.getElementById('view-students-section'),
        onEnter: () => onAdminViewEnter('Student Management', 'View, track, and manage student accounts.', 'students', fetchStudentsList)
    });

    ViewManager.registerView('tracking', {
        nav: document.getElementById('nav-tracking'),
        mobNav: document.getElementById('mobile-nav-tracking'),
        section: document.getElementById('view-tracking-section'),
        onEnter: () => onAdminViewEnter('Student Task Tracking', 'Track task status and points earned by individual students.', 'tracking', fetchTrackingData)
    });

    ViewManager.registerView('manualAudits', {
        nav: document.getElementById('nav-manual-audits'),
        mobNav: document.getElementById('mobile-nav-manual-audits'),
        section: document.getElementById('view-manual-audits-section'),
        onEnter: () => onAdminViewEnter('Manual Engagement Audits', 'Review manual task submissions pending verification.', 'manualAudits', fetchManualAuditsOverview)
    });

    ViewManager.registerView('leaderboard', {
        nav: document.getElementById('nav-leaderboard'),
        mobNav: document.getElementById('mobile-nav-leaderboard'),
        section: document.getElementById('view-leaderboard-section'),
        onEnter: () => onAdminViewEnter('Leaderboard Rankings', 'Rankings of students sorted by total points accumulated.', 'leaderboard', fetchLeaderboard)
    });

    ViewManager.registerView('verificationLogs', {
        nav: document.getElementById('nav-verification-logs'),
        mobNav: document.getElementById('mobile-nav-verification-logs'),
        section: document.getElementById('view-verification-logs-section'),
        onEnter: () => onAdminViewEnter('Verification Audit Logs', 'Permanent audit records of comment verification attempts.', 'verificationLogs', fetchVerificationLogs)
    });

    ViewManager.registerView('settings', {
        nav: document.getElementById('nav-settings'),
        mobNav: document.getElementById('mobile-nav-settings'),
        section: document.getElementById('view-settings-section'),
        onEnter: () => onAdminViewEnter('System Settings', 'Configure external integrations and administrative preferences.', 'settings', fetchSettings)
    });

    // New Module 3 Infrastructure Routes
    ViewManager.registerView('verificationQueue', {
        nav: document.getElementById('nav-verification-queue'),
        mobNav: document.getElementById('mobile-nav-verification-queue'),
        section: document.getElementById('view-verification-queue-section'),
        onEnter: () => onAdminViewEnter('Verification Queue', 'Manage and verify pending student tasks.', 'verificationQueue')
    });

    ViewManager.registerView('history', {
        nav: document.getElementById('nav-history'),
        mobNav: document.getElementById('mobile-nav-history'),
        section: document.getElementById('view-history-section'),
        onEnter: () => onAdminViewEnter('History', 'Historical records of actions and tasks.', 'history')
    });

    ViewManager.registerView('reviewLogs', {
        nav: document.getElementById('nav-review-logs'),
        mobNav: document.getElementById('mobile-nav-review-logs'),
        section: document.getElementById('view-review-logs-section'),
        onEnter: () => onAdminViewEnter('Review Logs', 'Logs of administrative reviews and audits.', 'reviewLogs')
    });

    // Mobile menu toggles
    const mobileSidebar = document.getElementById('mobile-sidebar');
    document.getElementById('mobile-menu-toggle').addEventListener('click', () => {
        mobileSidebar.classList.remove('hidden');
    });
    document.getElementById('mobile-menu-close').addEventListener('click', () => {
        mobileSidebar.classList.add('hidden');
    });
    mobileSidebar.addEventListener('click', (e) => {
        if (e.target === mobileSidebar) mobileSidebar.classList.add('hidden');
    });

    // Link top right dashboard header button`;

adminJs = adminJs.replace(viewBlockRegex, replacement);

// Also update switchView calls inside adminJs:
adminJs = adminJs.replace(/switchView\(/g, 'ViewManager.switchView(');

// Initialization ViewManager.init('dashboard'); should happen at the end.
adminJs = adminJs.replace(/ViewManager\.switchView\('dashboard'\);/g, "ViewManager.init('dashboard');");

fs.writeFileSync('public/js/admin.js', adminJs);
console.log('admin.js updated for ViewManager.');
