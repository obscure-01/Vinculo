/**
 * Vinculo View Manager
 * Centralizes the application's view switching and navigation lifecycle.
 */
window.ViewManager = (function() {
    let views = {};
    let activeKey = null;

    const ACTIVE_NAV_CLASSES = ['text-primary-fixed-dim', 'font-bold', 'bg-on-secondary-container'];
    const INACTIVE_NAV_CLASSES = ['text-secondary-fixed-dim', 'font-normal'];

    /**
     * Registers a new view and its DOM dependencies.
     * @param {string} key - Unique identifier for the view.
     * @param {Object} config - Configuration object.
     * @param {HTMLElement} config.nav - Desktop navigation element.
     * @param {HTMLElement} config.mobNav - Mobile navigation element.
     * @param {HTMLElement} config.section - Content container section.
     * @param {Function} [config.onEnter] - Callback triggered when view is displayed.
     */
    function registerView(key, { nav, mobNav, section, onEnter }) {
        if (views[key]) {
            console.warn(`[ViewManager] View "${key}" is already registered. Skipping.`);
            return;
        }
        
        if (!section) {
            console.warn(`[ViewManager] Cannot register view "${key}" because its section container is missing.`);
        }

        views[key] = { nav, mobNav, section, onEnter };
    }

    /**
     * Switches the active view.
     * @param {string} viewKey - The key of the view to switch to.
     */
    function switchView(viewKey) {
        if (!views[viewKey]) {
            console.warn(`[ViewManager] Attempted to switch to unknown view: "${viewKey}". Aborting.`);
            return;
        }

        const v = views[viewKey];

        // If clicking the same active view, just trigger a refresh via onEnter
        if (activeKey === viewKey) {
            if (v.onEnter) v.onEnter();
            closeMobileSidebar();
            return;
        }

        // Deactivate all views
        Object.keys(views).forEach(key => {
            const currentView = views[key];
            if (currentView.section) currentView.section.classList.add('hidden');
            
            if (currentView.nav) {
                currentView.nav.classList.remove(...ACTIVE_NAV_CLASSES);
                currentView.nav.classList.add(...INACTIVE_NAV_CLASSES);
                currentView.nav.removeAttribute('aria-current');
            }
            if (currentView.mobNav) {
                currentView.mobNav.classList.remove(...ACTIVE_NAV_CLASSES);
                currentView.mobNav.classList.add(...INACTIVE_NAV_CLASSES);
                currentView.mobNav.removeAttribute('aria-current');
            }
        });

        // Activate new view
        if (v.section) v.section.classList.remove('hidden');
        
        if (v.nav) {
            v.nav.classList.remove(...INACTIVE_NAV_CLASSES);
            v.nav.classList.add(...ACTIVE_NAV_CLASSES);
            v.nav.setAttribute('aria-current', 'page');
        }
        if (v.mobNav) {
            v.mobNav.classList.remove(...INACTIVE_NAV_CLASSES);
            v.mobNav.classList.add(...ACTIVE_NAV_CLASSES);
            v.mobNav.setAttribute('aria-current', 'page');
        }

        activeKey = viewKey;

        if (v.onEnter) v.onEnter();

        closeMobileSidebar();

        try {
            sessionStorage.setItem('vinculo_last_view', activeKey);
        } catch(e) {}
    }

    function closeMobileSidebar() {
        const mobileSidebar = document.getElementById('mobile-sidebar');
        if (mobileSidebar) {
            mobileSidebar.classList.add('hidden');
        }
    }

    /**
     * Initializes the view manager by binding event listeners to all registered views.
     * @param {string} defaultKey - The key of the view to activate on startup.
     */
    function init(defaultKey) {
        Object.keys(views).forEach(key => {
            const v = views[key];
            if (v.nav) {
                v.nav.addEventListener('click', () => switchView(key));
            }
            if (v.mobNav) {
                v.mobNav.addEventListener('click', () => switchView(key));
            }
        });

        let targetKey = defaultKey;
        try {
            const saved = sessionStorage.getItem('vinculo_last_view');
            if (saved && views[saved]) {
                targetKey = saved;
            }
        } catch(e) {}

        if (targetKey && views[targetKey]) {
            switchView(targetKey);
        } else if (defaultKey) {
            switchView(defaultKey);
        }
    }

    return {
        registerView,
        switchView,
        init
    };
})();
