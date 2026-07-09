/**
 * ui-components.js
 * Frontend Shared UI Infrastructure (Module 2)
 *
 * Provides a reusable, presentation-only UI foundation.
 * No business logic, backend calls, or feature-specific state.
 */

window.UI = (() => {
    
    // =========================================================================
    // BUTTON FOUNDATION
    // =========================================================================
    const Button = {
        render: ({ variant = 'primary', text = '', icon = '', disabled = false, loading = false, type = 'button', className = '' }) => {
            const baseClass = "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-DEFAULT text-sm font-semibold h-10 transition-colors";
            
            const variants = {
                primary: "bg-primary text-on-primary hover:bg-on-primary-fixed-variant",
                secondary: "bg-surface-container-high text-on-surface hover:bg-surface-container-highest border border-outline-variant",
                danger: "bg-error text-on-error hover:bg-error/90",
                success: "bg-tertiary text-on-tertiary hover:bg-tertiary/90",
                outline: "bg-transparent text-primary border border-outline hover:bg-surface-container"
            };

            const appliedVariant = disabled || loading 
                ? "bg-surface-container text-on-surface-variant cursor-not-allowed border border-outline-variant"
                : variants[variant] || variants.primary;

            const iconHtml = loading 
                ? `<span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>`
                : icon ? `<span class="material-symbols-outlined text-[18px]">${icon}</span>` : '';

            return `
                <button type="${type}" class="${baseClass} ${appliedVariant} ${className}" ${disabled || loading ? 'disabled' : ''}>
                    ${iconHtml}
                    ${text}
                </button>
            `;
        }
    };

    // =========================================================================
    // BADGE FOUNDATION
    // =========================================================================
    const Badge = {
        render: ({ status = 'neutral', text, className = '' }) => {
            const baseClass = "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold border";
            
            const statuses = {
                success: "bg-tertiary-container text-on-tertiary-container border-tertiary-fixed",
                warning: "bg-amber-100 text-amber-800 border-amber-200",
                error: "bg-error-container text-on-error-container border-[#fbdfe1]",
                info: "bg-secondary-container text-on-secondary-container border-outline-variant",
                neutral: "bg-surface-container-high text-on-surface-variant border-transparent"
            };

            const appliedStatus = statuses[status] || statuses.neutral;

            return `<span class="${baseClass} ${appliedStatus} ${className}">${text}</span>`;
        }
    };

    // =========================================================================
    // TOAST FOUNDATION
    // =========================================================================
    const Toast = (() => {
        let queue = [];
        const MAX_TOASTS = 3;
        
        let container = document.getElementById('ui-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ui-toast-container';
            container.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-3 w-full px-4 pointer-events-none';
            document.body.appendChild(container);
        }

        const icons = {
            success: { icon: 'check_circle', color: 'text-tertiary', border: 'border-tertiary' },
            error: { icon: 'error', color: 'text-error', border: 'border-error' },
            warning: { icon: 'warning', color: 'text-amber-500', border: 'border-amber-500' },
            info: { icon: 'info', color: 'text-primary', border: 'border-primary' }
        };

        function show({ message, type = 'info', duration = 5000 }) {
            // Deduplication
            if (queue.some(t => t.message === message && t.type === type)) {
                return;
            }

            const config = icons[type] || icons.info;
            
            const toastEl = document.createElement('div');
            toastEl.className = `pointer-events-auto bg-surface border-l-4 ${config.border} p-4 flex items-center justify-between shadow-lg max-w-xl w-full transition-all duration-300 opacity-0 translate-y-4`;
            
            toastEl.innerHTML = `
                <div class="flex items-center gap-3 overflow-hidden">
                    <span class="material-symbols-outlined ${config.color}">${config.icon}</span>
                    <span class="text-sm font-medium text-on-surface truncate" title="${escapeHTML(message)}">${escapeHTML(message)}</span>
                </div>
                <button class="text-on-surface-variant hover:text-on-surface transition-colors ml-4 shrink-0" aria-label="Close toast">
                    <span class="material-symbols-outlined text-[18px]">close</span>
                </button>
            `;

            const toastObj = { message, type, element: toastEl, timeout: null };
            
            // Queue Management
            if (queue.length >= MAX_TOASTS) {
                const oldest = queue.shift();
                dismiss(oldest);
            }
            queue.push(toastObj);

            container.appendChild(toastEl);
            
            // Animate in
            requestAnimationFrame(() => {
                toastEl.classList.remove('opacity-0', 'translate-y-4');
            });

            // Close binding
            const closeBtn = toastEl.querySelector('button');
            closeBtn.addEventListener('click', () => dismiss(toastObj));

            // Auto dismiss
            if (duration > 0) {
                toastObj.timeout = setTimeout(() => dismiss(toastObj), duration);
                
                toastEl.addEventListener('mouseenter', () => clearTimeout(toastObj.timeout));
                toastEl.addEventListener('mouseleave', () => {
                    toastObj.timeout = setTimeout(() => dismiss(toastObj), duration);
                });
            }
        }

        function dismiss(toastObj) {
            clearTimeout(toastObj.timeout);
            const el = toastObj.element;
            el.classList.add('opacity-0', '-translate-y-2');
            el.addEventListener('transitionend', () => {
                if (el.parentNode) el.parentNode.removeChild(el);
            });
            queue = queue.filter(t => t !== toastObj);
        }

        // Helper for raw HTML escaping if used before utils.js loads
        function escapeHTML(str) {
            if (!str) return '';
            return String(str).replace(/[&<>'"]/g, tag => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
            }[tag] || tag));
        }

        return { show };
    })();

    // =========================================================================
    // DIALOG FOUNDATION
    // =========================================================================
    const Dialog = {
        create: ({ id, title, body, actions = [], onClose }) => {
            const container = document.createElement('div');
            container.id = id || `dialog-${Date.now()}`;
            container.className = "fixed inset-0 z-[100] flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm opacity-0 transition-opacity duration-200";
            container.setAttribute('role', 'dialog');
            container.setAttribute('aria-modal', 'true');
            container.setAttribute('aria-labelledby', `${container.id}-title`);

            let actionsHtml = '';
            if (actions.length > 0) {
                actionsHtml = `<div class="p-4 border-t border-surface-container flex justify-end gap-3 bg-surface-container-lowest">
                    ${actions.map(btn => Button.render(btn)).join('')}
                </div>`;
            }

            const bodyContent = typeof body === 'string' ? body : '';

            container.innerHTML = `
                <div class="bg-surface rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden transform scale-95 transition-transform duration-200" role="document">
                    <div class="px-6 py-4 border-b border-surface-container flex items-center justify-between">
                        <h2 id="${container.id}-title" class="text-lg font-bold text-on-surface font-headline">${escapeHTML(title)}</h2>
                        <button class="dialog-close text-on-surface-variant hover:text-on-surface p-1 rounded-full hover:bg-surface-container transition-colors" aria-label="Close">
                            <span class="material-symbols-outlined">close</span>
                        </button>
                    </div>
                    <div class="p-6 max-h-[70vh] overflow-y-auto">
                        ${bodyContent}
                    </div>
                    ${actionsHtml}
                </div>
            `;

            if (typeof body !== 'string') {
                container.querySelector('.p-6').appendChild(body);
            }

            // Focus trapping
            const focusableElements = container.querySelectorAll('a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])');
            const firstFocusable = focusableElements[0];
            const lastFocusable = focusableElements[focusableElements.length - 1];

            const handleTab = (e) => {
                if (e.key !== 'Tab') return;
                if (e.shiftKey) {
                    if (document.activeElement === firstFocusable) {
                        lastFocusable.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === lastFocusable) {
                        firstFocusable.focus();
                        e.preventDefault();
                    }
                }
            };

            const previousActiveElement = document.activeElement;

            const instance = {
                element: container,
                open: () => {
                    document.body.appendChild(container);
                    document.body.style.overflow = 'hidden';
                    
                    // Force reflow
                    container.offsetHeight; 
                    
                    container.classList.remove('opacity-0');
                    container.querySelector('[role="document"]').classList.remove('scale-95');
                    
                    if (firstFocusable) firstFocusable.focus();
                    
                    container.addEventListener('keydown', handleTab);
                    
                    // Close bindings
                    const handleEscape = (e) => { if (e.key === 'Escape') instance.close(); };
                    document.addEventListener('keydown', handleEscape);
                    
                    const handleBackdrop = (e) => { if (e.target === container) instance.close(); };
                    container.addEventListener('click', handleBackdrop);

                    const closeBtns = container.querySelectorAll('.dialog-close');
                    closeBtns.forEach(btn => btn.addEventListener('click', instance.close));

                    // Store cleanup functions
                    instance.cleanup = () => {
                        document.removeEventListener('keydown', handleEscape);
                        container.removeEventListener('keydown', handleTab);
                        container.removeEventListener('click', handleBackdrop);
                        closeBtns.forEach(btn => btn.removeEventListener('click', instance.close));
                    };

                    // Bind action buttons if callback provided in config
                    const actionElements = container.querySelector('.border-t')?.querySelectorAll('button');
                    if (actionElements) {
                        actionElements.forEach((btnEl, index) => {
                            if (actions[index] && typeof actions[index].onClick === 'function') {
                                btnEl.addEventListener('click', (e) => actions[index].onClick(e, instance));
                            }
                        });
                    }
                },
                close: () => {
                    container.classList.add('opacity-0');
                    container.querySelector('[role="document"]').classList.add('scale-95');
                    
                    if (instance.cleanup) instance.cleanup();
                    
                    container.addEventListener('transitionend', (e) => {
                        if (e.target === container) {
                            if (container.parentNode) container.parentNode.removeChild(container);
                            document.body.style.overflow = '';
                            if (previousActiveElement) previousActiveElement.focus();
                            if (typeof onClose === 'function') onClose();
                        }
                    }, { once: true });
                }
            };

            return instance;
        }
    };

    // =========================================================================
    // TABLE FOUNDATION
    // =========================================================================
    const Table = {
        loadingRow: ({ colspan, message = 'Loading data...' }) => `
            <tr>
                <td colspan="${colspan}" class="px-6 py-8 text-center text-sm text-on-surface-variant">
                    <div class="flex flex-col items-center justify-center gap-3">
                        <span class="material-symbols-outlined animate-spin text-[24px] text-primary">progress_activity</span>
                        <p>${escapeHTML(message)}</p>
                    </div>
                </td>
            </tr>
        `,
        emptyRow: ({ colspan, message = 'No data available.' }) => `
            <tr>
                <td colspan="${colspan}" class="px-6 py-8 text-center text-sm text-on-surface-variant">
                    ${escapeHTML(message)}
                </td>
            </tr>
        `,
        errorRow: ({ colspan, message = 'Failed to load data.', retryAction }) => `
            <tr>
                <td colspan="${colspan}" class="px-6 py-8 text-center text-sm text-error">
                    <div class="flex flex-col items-center justify-center gap-3">
                        <span class="material-symbols-outlined text-[24px]">error</span>
                        <p>${escapeHTML(message)}</p>
                        ${retryAction ? `<button class="text-primary hover:underline font-semibold" onclick="${retryAction}">Retry</button>` : ''}
                    </div>
                </td>
            </tr>
        `,
        noResultsRow: ({ colspan, message = 'No matching records found.' }) => `
            <tr>
                <td colspan="${colspan}" class="px-6 py-8 text-center text-sm text-on-surface-variant">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <span class="material-symbols-outlined text-[24px]">search_off</span>
                        <p>${escapeHTML(message)}</p>
                    </div>
                </td>
            </tr>
        `
    };

    // =========================================================================
    // STATE (EMPTY / ERROR)
    // =========================================================================
    const State = {
        empty: ({ icon = 'inbox', title, description, primaryAction }) => {
            const actionHtml = primaryAction ? Button.render(primaryAction) : '';
            return `
                <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div class="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center mb-4">
                        <span class="material-symbols-outlined text-[32px] text-on-surface-variant">${icon}</span>
                    </div>
                    <h3 class="text-lg font-bold text-on-surface mb-2">${escapeHTML(title)}</h3>
                    ${description ? `<p class="text-sm text-on-surface-variant mb-6 max-w-sm">${escapeHTML(description)}</p>` : ''}
                    ${actionHtml}
                </div>
            `;
        },
        error: ({ title = 'Unexpected Error', description, retryAction }) => {
            const actionHtml = retryAction ? Button.render({ variant: 'outline', text: 'Retry', icon: 'refresh', ...retryAction }) : '';
            return `
                <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <div class="w-16 h-16 rounded-full bg-error-container flex items-center justify-center mb-4">
                        <span class="material-symbols-outlined text-[32px] text-error">warning</span>
                    </div>
                    <h3 class="text-lg font-bold text-on-surface mb-2">${escapeHTML(title)}</h3>
                    ${description ? `<p class="text-sm text-on-surface-variant mb-6 max-w-sm">${escapeHTML(description)}</p>` : ''}
                    ${actionHtml}
                </div>
            `;
        },
        loading: ({ message = 'Loading...' }) => {
            return `
                <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <span class="material-symbols-outlined animate-spin text-[32px] text-primary mb-4">progress_activity</span>
                    <p class="text-sm text-on-surface-variant">${escapeHTML(message)}</p>
                </div>
            `;
        }
    };

    // Helper exposed internally for escaping
    function escapeHTML(str) {
        if (!str) return '';
        return String(str).replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag));
    }

    return {
        Button,
        Badge,
        Toast,
        Dialog,
        Table,
        State
    };
})();
