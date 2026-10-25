const fs = require('fs');
let studentJs = fs.readFileSync('public/js/student.js', 'utf8');

// The views object and switchView function need to be replaced.
// We will look for:
// const views = { ... };
// // Navigation controller
// function switchView(viewKey) { ... }
// // Attach click events
// ...
// We will replace this entire block with a ViewManager setup.

const viewBlockRegex = /const views = \{[\s\S]*?\/\/ Logout actions/m;

const replacement = `    // Register Views
    ViewManager.registerView('dashboard', {
        nav: document.getElementById('nav-dashboard'),
        mobNav: document.getElementById('mobile-nav-dashboard'),
        section: document.getElementById('view-dashboard-section'),
        onEnter: () => {
            fetchWelcomeDashboard();
            fetchPendingTasks();
            fetchLeaderboardSnippet();
            fetchProfileSnippet();
        }
    });

    ViewManager.registerView('tasks', {
        nav: document.getElementById('nav-tasks'),
        mobNav: document.getElementById('mobile-nav-tasks'),
        section: document.getElementById('view-tasks-section'),
        onEnter: fetchPendingTasks
    });
    
    ViewManager.registerView('task-progress', {
        nav: document.getElementById('nav-task-progress'),
        mobNav: document.getElementById('mobile-nav-task-progress'),
        section: document.getElementById('view-task-progress-section')
    });

    ViewManager.registerView('completed', {
        nav: document.getElementById('nav-completed'),
        mobNav: document.getElementById('mobile-nav-completed'),
        section: document.getElementById('view-completed-section'),
        onEnter: fetchCompletedTasks
    });

    ViewManager.registerView('leaderboard', {
        nav: document.getElementById('nav-leaderboard'),
        mobNav: document.getElementById('mobile-nav-leaderboard'),
        section: document.getElementById('view-leaderboard-section'),
        onEnter: fetchFullLeaderboard
    });

    ViewManager.registerView('profile', {
        nav: document.getElementById('nav-profile'),
        mobNav: document.getElementById('mobile-nav-profile'),
        section: document.getElementById('view-profile-section'),
        onEnter: fetchFullProfile
    });

    // Mobile menu toggles
    const mobileSidebar = document.getElementById('mobile-sidebar');
    document.getElementById('mobile-menu-toggle').addEventListener('click', () => {
        mobileSidebar.classList.remove('hidden');
    });
    document.getElementById('mobile-menu-close').addEventListener('click', () => {
        mobileSidebar.classList.add('hidden');
    });
    // Removed closing via mobileSidebar body click because ViewManager handles it on navigation.
    // However, if they just click the backdrop, we can still hide it:
    mobileSidebar.addEventListener('click', (e) => {
        if (e.target === mobileSidebar) mobileSidebar.classList.add('hidden');
    });

    // Logout actions`;

studentJs = studentJs.replace(viewBlockRegex, replacement);

// Also update switchView calls inside studentJs:
// e.g. switchView('tasks') -> ViewManager.switchView('tasks')
studentJs = studentJs.replace(/switchView\(/g, 'ViewManager.switchView(');

// Wait, the initialization ViewManager.init('dashboard'); should happen at the end.
studentJs = studentJs.replace(/ViewManager\.switchView\('dashboard'\);/g, "ViewManager.init('dashboard');");

fs.writeFileSync('public/js/student.js', studentJs);
console.log('student.js updated for ViewManager.');
