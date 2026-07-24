// Student Dashboard Javascript - EngageHub

document.addEventListener('DOMContentLoaded', () => {
    // 1. Authenticate and enforce Student role
    const studentUser = checkAuth('Student');
    if (!studentUser) return; // checkAuth will handle redirect

    // Display Header Info
    document.getElementById('student-name-header').textContent = studentUser.name;
    const avatarContainer = document.getElementById('avatar-container');
    const userInitials = studentUser.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    avatarContainer.textContent = userInitials;

    // DOM Elements - Sidebar Navigation (Desktop & Mobile)
        // Register Views
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
        section: document.getElementById('view-task-progress-section'),
        onEnter: fetchTaskProgress
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

    // Logout actions
    document.getElementById('btn-logout').addEventListener('click', logout);
    document.getElementById('btn-mobile-logout').addEventListener('click', logout);

    // Dashboard shortcuts
    document.getElementById('btn-view-all-pending').addEventListener('click', () => ViewManager.switchView('tasks'));
    document.getElementById('btn-view-full-leaderboard').addEventListener('click', () => ViewManager.switchView('leaderboard'));

    function showAlert(message, isError = false) {
        UI.Toast.show({ message, type: isError ? 'error' : 'success' });
    }

    // ──────────────────────────────────────────────────────────
    // DATA FETCHERS & RENDERING
    // ──────────────────────────────────────────────────────────
    // Platform icon helper
    function getPlatformIcon(platform) {
        const plat = platform.toLowerCase();
        if (plat === 'instagram') return 'movie';
        if (plat === 'youtube') return 'play_circle';
        if (plat === 'linkedin') return 'work';
        if (plat === 'facebook') return 'thumb_up';
        return 'link';
    }

    // 1. Welcome Card Points & Rank Display
    async function fetchWelcomeDashboard() {
        try {
            const data = await apiRequest('/api/student/dashboard');
            document.getElementById('welcome-name-card').textContent = `Welcome back, ${data.name}!`;
            document.getElementById('welcome-points-card').textContent = data.points.toLocaleString();
            document.getElementById('welcome-rank-card').textContent = data.rank;
        } catch (error) {
            showAlert('Failed to load student statistics', true);
        }
    }

    // 2. Pending Tasks (rendered in Dashboard and Tasks page)
    async function fetchPendingTasks() {
        const dbGrid = document.getElementById('dashboard-tasks-grid');
        const allGrid = document.getElementById('all-tasks-grid');

        const loadingState = UI.State.empty({ icon: 'hourglass_empty', title: 'Loading...', description: 'Fetching your tasks.' });
        dbGrid.innerHTML = loadingState;
        allGrid.innerHTML = loadingState;

        try {
            const tasks = await apiRequest('/api/student/tasks');
            
            if (tasks.length === 0) {
                const emptyHTML = UI.State.empty({
                    icon: 'task_alt',
                    title: 'All Caught Up!',
                    description: 'There are no pending tasks for you right now.'
                });
                dbGrid.innerHTML = emptyHTML;
                allGrid.innerHTML = emptyHTML;
                return;
            }

            // Generate HTML for tasks
            const buildCards = (taskList) => taskList.map(task => {
                const platformIcon = getPlatformIcon(task.platform);
                const isOpened = task.status === 'OPENED';
                
                // Button styling based on status and verification method
                const isManual = task.verification_method === 'MANUAL';
                
                let buttonText = 'Open Task';
                let actionHandler = `openTask(${task.id})`;
                let buttonClass = 'bg-primary text-on-primary hover:bg-on-primary-fixed-variant';

                let statusBadge = '';
                let rejectionInfo = '';

                if (task.manual_audit_status === 'PENDING' || task.manual_audit_status === 'UNDER_REVIEW') {
                    statusBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">PENDING REVIEW</span>`;
                } else if (task.manual_audit_status === 'REJECTED') {
                    statusBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-error-container text-on-error-container border border-error">REJECTED</span>`;
                    if (task.rejection_reason) {
                        rejectionInfo = `<div class="mt-2 text-xs text-error font-medium flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">error</span> Reason: ${escapeHTML(task.rejection_reason)}</div>`;
                    }
                } else if (isOpened) {
                    statusBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-container text-on-primary-container border border-primary-fixed-dim">OPENED</span>`;
                }

                if (isOpened) {
                    if (isManual) {
                        if (task.manual_audit_status === 'PENDING') {
                            buttonText = 'Withdraw';
                            buttonClass = 'bg-surface text-error border border-error hover:bg-error-container';
                            actionHandler = `withdrawDeclaration(${task.id})`;
                        } else if (task.manual_audit_status === 'UNDER_REVIEW') {
                            buttonText = 'Under Review';
                            buttonClass = 'bg-surface-container-high text-on-surface-variant opacity-70 cursor-not-allowed';
                            actionHandler = `return false`;
                        } else {
                            buttonText = task.manual_audit_status === 'REJECTED' ? 'Resubmit for Review' : 'Submit for Review';
                            buttonClass = 'bg-secondary text-on-secondary hover:bg-secondary-fixed-dim';
                            actionHandler = `openManualAuditModal(${task.id}, '${escapeHTML(task.title).replace(/'/g, "\\'")}', '${task.platform}', '${task.engagement_type}')`;
                        }
                    } else {
                        buttonText = 'Mark Complete';
                        buttonClass = 'bg-tertiary text-on-tertiary hover:bg-on-tertiary-fixed-variant';
                        actionHandler = `completeTask(${task.id})`;
                    }
                }

                return `
                    <div class="bg-surface border border-outline-variant p-4 flex flex-col sm:flex-row sm:items-center justify-between hover:bg-surface-container-low transition-colors rounded-DEFAULT">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 bg-primary-container text-on-primary-container flex items-center justify-center rounded-DEFAULT shrink-0">
                                <span class="material-symbols-outlined">${platformIcon}</span>
                            </div>
                            <div>
                                <h4 class="font-semibold text-on-surface text-sm sm:text-base">${escapeHTML(task.title)}</h4>
                                <div class="flex items-center gap-2 mt-0.5">
                                    <span class="text-xs text-on-surface-variant font-medium">${task.platform}</span>
                                    ${statusBadge}
                                </div>
                                ${rejectionInfo}
                            </div>
                        </div>
                        <div class="flex items-center justify-start sm:justify-end gap-4 sm:gap-6 mt-4 sm:mt-0 shrink-0">
                            <div class="text-left sm:text-right">
                                <p class="text-sm font-bold text-tertiary">+10 pts</p>
                            </div>
                            <button onclick="${actionHandler}" class="${buttonClass} px-3 sm:px-4 py-2 font-semibold text-xs sm:text-sm transition-colors rounded-DEFAULT shrink-0">
                                ${buttonText}
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            // Render top 3 in dashboard overview
            dbGrid.innerHTML = buildCards(tasks.slice(0, 3));
            // Render all in full tasks page
            allGrid.innerHTML = buildCards(tasks);

        } catch (error) {
            const errState = UI.State.error({ title: 'Failed to load tasks', description: error.message });
            dbGrid.innerHTML = errState;
            allGrid.innerHTML = errState;
        }
    }

    // Open Task Action
    window.openTask = async function(taskId) {

        try {
            const data = await apiRequest(`/api/student/tasks/${taskId}/open`, { method: 'POST' });
            // Open task link in a new tab
            window.open(data.socialLink, '_blank');
            // Refresh task lists immediately
            fetchPendingTasks();
        } catch (error) {
            showAlert('Failed to open task. Please try again.', true);
        }
    };

    // Manual Audit Modal Logic
    const manualAuditModal = document.getElementById('manual-audit-modal');
    let currentManualAuditTaskId = null;

    window.openManualAuditModal = function(taskId, title, platform, engagementType) {
        currentManualAuditTaskId = taskId;
        document.getElementById('modal-task-title').textContent = title;
        document.getElementById('modal-platform').textContent = platform;
        document.getElementById('modal-engagement-type').textContent = engagementType;
        manualAuditModal.classList.remove('hidden');
    };

    function closeManualAuditModal() {
        manualAuditModal.classList.add('hidden');
        currentManualAuditTaskId = null;
    }

    document.getElementById('close-manual-audit-btn')?.addEventListener('click', closeManualAuditModal);
    document.getElementById('cancel-manual-audit-btn')?.addEventListener('click', closeManualAuditModal);
    document.getElementById('manual-audit-overlay')?.addEventListener('click', closeManualAuditModal);

    document.getElementById('confirm-manual-audit-btn')?.addEventListener('click', async () => {
        if (!currentManualAuditTaskId) return;
        try {
            const data = await apiRequest(`/api/student/tasks/${currentManualAuditTaskId}/manual-audit`, { method: 'POST' });
            showAlert(data.message, data.status ? true : false); // If status exists, it's a duplicate, show as warning
            closeManualAuditModal();
            fetchPendingTasks();
        } catch (error) {
            showAlert(error.message, true);
            closeManualAuditModal();
        }
    });

    // Withdraw Declaration Action
    window.withdrawDeclaration = async function(taskId) {
        if (!confirm('Are you sure you want to withdraw this task from review?')) return;

        try {
            const data = await apiRequest(`/api/student/tasks/${taskId}/withdraw`, { method: 'POST' });
            showAlert(data.message, false);
            fetchPendingTasks();
        } catch (error) {
            showAlert(error.message, true);
        }
    };

    // Complete Task Action
    window.completeTask = async function(taskId) {

        try {
            const data = await apiRequest(`/api/student/tasks/${taskId}/complete`, { method: 'POST' });
            // Show Success Notification
            showAlert(data.message, false);
            // Refresh dashboard data
            fetchPendingTasks();
            fetchWelcomeDashboard();
        } catch (error) {
            showAlert(error.message, true);
        }
    };

    // 3. Task Progress list
    async function fetchTaskProgress() {
        const progressList = document.getElementById('task-progress-list');
        const emptyState = document.getElementById('task-progress-empty');
        const skeleton = document.getElementById('task-progress-skeleton');
        
        if (progressList) progressList.innerHTML = '';
        if (emptyState) emptyState.classList.add('hidden');
        if (skeleton) skeleton.classList.remove('hidden');

        try {
            const tasks = await apiRequest('/api/student/tasks/progress');
            if (skeleton) skeleton.classList.add('hidden');

            if (tasks.length === 0) {
                if (emptyState) {
                    emptyState.classList.remove('hidden');
                } else {
                    progressList.innerHTML = `
                        <div class="bg-surface border border-outline-variant p-8 text-center rounded-DEFAULT">
                            <span class="material-symbols-outlined text-4xl text-on-surface-variant mb-2">assignment_late</span>
                            <p class="font-semibold text-on-surface text-base">No Progress History Yet</p>
                            <p class="text-xs text-on-surface-variant mt-1">Start engaging with assigned tasks in your dashboard to build your record.</p>
                        </div>
                    `;
                }
                return;
            }

            progressList.innerHTML = tasks.map(task => {
                const platformIcon = getPlatformIcon(task.platform);
                const formattedDate = task.completed_at ? new Date(task.completed_at).toLocaleString() : 'N/A';
                const totalPoints = 10 + (task.comment_points_awarded || 0);
                const isManual = task.verification_method === 'MANUAL';

                let statusBadge = '';
                let rejectionInfo = '';
                let pointsHTML = '';

                if (isManual) {
                    if (task.manual_audit_status === 'APPROVED') {
                        statusBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-tertiary-container text-on-tertiary-container border border-tertiary-fixed">APPROVED</span>`;
                        pointsHTML = `<p class="text-sm font-bold text-tertiary">${totalPoints} pts earned</p>`;
                    } else if (task.manual_audit_status === 'REJECTED') {
                        statusBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-error-container text-on-error-container border border-error">REJECTED</span>`;
                        pointsHTML = `<p class="text-sm font-bold text-on-surface-variant line-through opacity-50">${totalPoints} pts earned</p>`;
                        if (task.rejection_reason) {
                            rejectionInfo = `<div class="mt-2 text-xs text-error font-medium flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">error</span> Reason: ${escapeHTML(task.rejection_reason)}</div>`;
                        }
                    } else { // PENDING or UNDER_REVIEW
                        statusBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">PENDING REVIEW</span>`;
                        pointsHTML = `<p class="text-sm font-bold text-on-surface-variant opacity-70">${totalPoints} pts pending</p>`;
                    }
                } else {
                    // Automatic Tasks
                    statusBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-tertiary-container text-on-tertiary-container border border-tertiary-fixed">COMPLETED</span>`;
                    pointsHTML = `<p class="text-sm font-bold text-tertiary">${totalPoints} pts earned</p>`;
                }

                return `
                    <div class="bg-surface border border-outline-variant p-4 flex flex-col sm:flex-row justify-between hover:bg-surface-container-low transition-colors rounded-DEFAULT gap-4">
                        <div class="flex items-start sm:items-center gap-4">
                            <div class="w-12 h-12 bg-surface-container text-on-surface-variant flex items-center justify-center rounded-DEFAULT shrink-0">
                                <span class="material-symbols-outlined">${platformIcon}</span>
                            </div>
                            <div>
                                <h4 class="font-semibold text-on-surface text-sm sm:text-base">${escapeHTML(task.title)}</h4>
                                <div class="flex flex-wrap items-center gap-2 mt-1">
                                    <span class="text-xs text-on-surface-variant font-medium">${task.platform} • Updated: ${formattedDate}</span>
                                    ${statusBadge}
                                </div>
                                ${rejectionInfo}
                            </div>
                        </div>
                        <div class="flex items-center sm:items-end justify-start sm:justify-end gap-6 shrink-0 mt-2 sm:mt-0">
                            <div class="text-left sm:text-right">
                                ${pointsHTML}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

        } catch (error) {
            if (skeleton) skeleton.classList.add('hidden');
            progressList.innerHTML = UI.State.error({ title: 'Error', description: 'Failed to load task progress.' });
        }
    }
    window.verifyComment = async function(taskId) {

        try {
            const data = await apiRequest(`/api/student/tasks/${taskId}/verify-comment`, { method: 'POST' });
            
            // Check if comment was successfully verified (detected)
            const isError = data.comment_status !== 'Comment Detected' && data.comment_status !== 'Comment Verified' && data.comment_status !== 'Verification Successful';
            showAlert(data.message, isError);
            
            // Refresh lists and stats
            fetchTaskProgress();
            fetchWelcomeDashboard();
        } catch (error) {
            showAlert(error.message || 'Verification failed. Please try again.', true);
        }
    };

    // 4. Leaderboard Snippet (Top 3 + You)
    async function fetchLeaderboardSnippet() {
        const snippetList = document.getElementById('dashboard-leaderboard-list');
        snippetList.innerHTML = UI.State.loading({ message: 'Loading top performers...' });

        try {
            const rankings = await apiRequest('/api/student/leaderboard');
            if (rankings.length === 0) {
                snippetList.innerHTML = UI.State.empty({ icon: 'trophy', title: 'No Rankings', description: 'No student records.' });
                return;
            }

            // Pick Top 3
            const topThree = rankings.slice(0, 3);
            
            // Find current user row in rankings
            const currentUserRankIdx = rankings.findIndex(r => r.id === studentUser.id);
            const currentUserRankRow = currentUserRankIdx !== -1 ? rankings[currentUserRankIdx] : null;

            // Check if current user is already in top 3
            const userInTopThree = currentUserRankIdx !== -1 && currentUserRankIdx < 3;

            let htmlContent = topThree.map(student => {
                const isMe = student.id === studentUser.id;
                const activeClass = isMe ? 'bg-primary-fixed bg-opacity-20 font-bold border-l-2 border-primary' : '';
                const initials = student.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
                
                return `
                    <li class="p-4 flex items-center justify-between ${activeClass}">
                        <div class="flex items-center gap-3">
                            <span class="font-bold text-secondary w-6 text-center">${student.rank}</span>
                            <div class="w-8 h-8 rounded-full bg-primary-container flex items-center justify-center text-on-primary-container text-xs font-bold shrink-0">
                                ${initials}
                            </div>
                            <span class="text-on-surface font-medium truncate max-w-[120px] sm:max-w-none">${escapeHTML(student.name)}${isMe ? ' (You)' : ''}</span>
                        </div>
                        <span class="font-bold text-primary">${student.points} pts</span>
                    </li>
                `;
            }).join('');

            // If current user is not in top 3, append their row at the end of list
            if (!userInTopThree && currentUserRankRow) {
                const initials = currentUserRankRow.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
                htmlContent += `
                    <li class="p-4 flex items-center justify-between bg-primary-fixed bg-opacity-20 font-bold border-l-2 border-primary">
                        <div class="flex items-center gap-3">
                            <span class="font-bold text-primary w-6 text-center">${currentUserRankRow.rank}</span>
                            <div class="w-8 h-8 rounded-full border-2 border-primary bg-primary-container text-primary flex items-center justify-center text-xs font-bold shrink-0">
                                ${initials}
                            </div>
                            <span class="text-on-surface truncate max-w-[120px] sm:max-w-none">${escapeHTML(currentUserRankRow.name)} (You)</span>
                        </div>
                        <span class="font-bold text-primary">${currentUserRankRow.points} pts</span>
                    </li>
                `;
            }

            snippetList.innerHTML = htmlContent;

        } catch (error) {
            snippetList.innerHTML = '<p class="text-sm text-error p-4">Failed to load leaderboard snippet.</p>';
        }
    }

    // 5. Full Leaderboard stand
    async function fetchFullLeaderboard() {
        const rowsContainer = document.getElementById('full-leaderboard-rows');
        rowsContainer.innerHTML = UI.Table.loadingRow({ colspan: 3, message: 'Loading rankings database...' });

        try {
            const rankings = await apiRequest('/api/student/leaderboard');
            if (rankings.length === 0) {
                rowsContainer.innerHTML = UI.Table.emptyRow({ colspan: 3, message: 'No student records.' });
                return;
            }

            rowsContainer.innerHTML = rankings.map(student => {
                const isMe = student.id === studentUser.id;
                const activeClass = isMe ? 'bg-primary-fixed bg-opacity-25 font-bold border-l-2 border-primary' : '';
                
                let medalClass = 'text-secondary';
                if (student.rank == 1) medalClass = 'text-amber-500 font-black scale-110';
                else if (student.rank == 2) medalClass = 'text-slate-400 font-bold';
                else if (student.rank == 3) medalClass = 'text-amber-700';

                return `
                    <tr class="${activeClass} hover:bg-surface-container-low/50 transition-colors">
                        <td class="px-6 py-4 text-center font-black ${medalClass}">${student.rank}</td>
                        <td class="px-6 py-4 font-semibold text-on-surface">${escapeHTML(student.name)}${isMe ? ' (You)' : ''}</td>
                        <td class="px-6 py-4 text-right px-12 font-black text-primary">${student.points} pts</td>
                    </tr>
                `;
            }).join('');

        } catch (error) {
            rowsContainer.innerHTML = UI.Table.errorRow({ colspan: 3, message: 'Failed to fetch leaderboard.' });
        }
    }

    // 6. Profile Snippet on Dashboard
    async function fetchProfileSnippet() {
        try {
            const data = await apiRequest('/api/student/profile');
            const initials = data.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            
            document.getElementById('profile-avatar-large').textContent = initials;
            document.getElementById('profile-name-large').textContent = data.name;
            document.getElementById('profile-points-large').textContent = `Total Points: ${data.points.toLocaleString()}`;
            document.getElementById('profile-completed-count').textContent = data.completedTasks;
            document.getElementById('profile-pending-count').textContent = data.pendingTasks;
        } catch (error) {
            console.error('Failed to load profile snippet:', error);
        }
    }

    // 7. Full Profile Page
    async function fetchFullProfile() {
        try {
            const data = await apiRequest('/api/student/profile');
            const initials = data.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

            document.getElementById('full-profile-avatar').textContent = initials;
            document.getElementById('full-profile-name').textContent = data.name;
            document.getElementById('full-profile-email').textContent = data.email;
            document.getElementById('full-profile-points').textContent = data.points.toLocaleString();
            document.getElementById('full-profile-completed').textContent = data.completedTasks;
            document.getElementById('full-profile-pending').textContent = data.pendingTasks;

            // Populate form inputs
            document.getElementById('profile-instagram').value = data.instagram_username || '';
            document.getElementById('profile-youtube').value = data.youtube_handle || '';
            document.getElementById('profile-linkedin').value = data.linkedin_profile || '';
            document.getElementById('profile-facebook').value = data.facebook_display_name || data.facebook_profile || '';

            // Populate display cards
            document.getElementById('display-instagram').textContent = data.instagram_username || 'Not Available';
            document.getElementById('display-youtube').textContent = data.youtube_handle || 'Not Available';
            document.getElementById('display-linkedin').textContent = data.linkedin_profile || 'Not Available';
            document.getElementById('display-facebook').textContent = data.facebook_display_name || data.facebook_profile || 'Not Available';

            // Tooltips
            document.getElementById('display-linkedin').title = data.linkedin_profile || 'Not Available';
            document.getElementById('display-facebook').title = data.facebook_display_name || data.facebook_profile || 'Not Available';

        } catch (error) {
            showAlert('Failed to load profile page data.', true);
        }
    }

    // Bind Profile Update Form Submit
    const socialForm = document.getElementById('social-profiles-form');
    if (socialForm) {
        socialForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const instagram_username = document.getElementById('profile-instagram').value.trim() || null;
            const youtube_handle = document.getElementById('profile-youtube').value.trim() || null;
            const linkedin_profile = document.getElementById('profile-linkedin').value.trim() || null;
            const facebook_display_name = document.getElementById('profile-facebook').value.trim() || null;

            try {
                const response = await apiRequest('/api/student/profile/social', {
                    method: 'PUT',
                    body: JSON.stringify({ instagram_username, youtube_handle, linkedin_profile, facebook_display_name })
                });
                showAlert(response.message, false);
                fetchFullProfile();
            } catch (error) {
                showAlert(error.message || 'Failed to update social profiles', true);
            }
        });
    }

    // Prevent HTML Injection
    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }

    // Initialize: Start on Dashboard view
    ViewManager.init('dashboard');
});
