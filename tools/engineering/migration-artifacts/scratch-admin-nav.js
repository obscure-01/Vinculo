const fs = require('fs');

let adminHtml = fs.readFileSync('public/admin.html', 'utf8');

// 1. Inject view-manager.js
if (!adminHtml.includes('view-manager.js')) {
    adminHtml = adminHtml.replace('<script src="js/ui-components.js"></script>', '<script src="js/ui-components.js"></script>\n    <script src="js/view-manager.js"></script>');
}

// 2. Add New Nav Items
const navInject = `
                <!-- New Architecture Routes -->
                <button id="nav-verification-queue" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container hover:text-inverse-on-surface transition-colors cursor-pointer transition-all duration-150 text-left">
                    <span class="material-symbols-outlined text-[20px]">queue</span>
                    Verification Queue
                </button>
                <button id="nav-history" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container hover:text-inverse-on-surface transition-colors cursor-pointer transition-all duration-150 text-left">
                    <span class="material-symbols-outlined text-[20px]">history</span>
                    History
                </button>
                <button id="nav-review-logs" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container hover:text-inverse-on-surface transition-colors cursor-pointer transition-all duration-150 text-left">
                    <span class="material-symbols-outlined text-[20px]">fact_check</span>
                    Review Logs
                </button>
`;

if (!adminHtml.includes('id="nav-verification-queue"')) {
    adminHtml = adminHtml.replace('</nav>', `${navInject}\n            </nav>`);
}

const mobNavInject = `
                        <!-- New Architecture Routes -->
                        <button id="mobile-nav-verification-queue" class="mobile-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container transition-colors text-left">
                            <span class="material-symbols-outlined text-[20px]">queue</span>
                            Verification Queue
                        </button>
                        <button id="mobile-nav-history" class="mobile-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container transition-colors text-left">
                            <span class="material-symbols-outlined text-[20px]">history</span>
                            History
                        </button>
                        <button id="mobile-nav-review-logs" class="mobile-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container transition-colors text-left">
                            <span class="material-symbols-outlined text-[20px]">fact_check</span>
                            Review Logs
                        </button>
`;

if (!adminHtml.includes('id="mobile-nav-verification-queue"')) {
    adminHtml = adminHtml.replace('id="mobile-sidebar"', 'id="mobile-sidebar"'); // find insertion point
    const insertPoint = adminHtml.indexOf('</nav>', adminHtml.indexOf('id="mobile-sidebar"'));
    adminHtml = adminHtml.substring(0, insertPoint) + mobNavInject + adminHtml.substring(insertPoint);
}

// 3. Add Section Containers
if (!adminHtml.includes('id="view-verification-queue-section"')) {
    const sectionInject = `
        <!-- Verification Queue Section -->
        <section id="view-verification-queue-section" class="hidden">
            <div class="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 class="text-3xl font-headline font-bold text-on-surface mb-2">Verification Queue</h2>
                    <p class="text-on-surface-variant text-body-lg max-w-2xl">Manage and verify pending student tasks.</p>
                </div>
            </div>
            <div id="verification-queue-container" class="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <!-- Dynamic content -->
            </div>
        </section>

        <!-- History Section -->
        <section id="view-history-section" class="hidden">
            <div class="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 class="text-3xl font-headline font-bold text-on-surface mb-2">History</h2>
                    <p class="text-on-surface-variant text-body-lg max-w-2xl">Historical records of actions and tasks.</p>
                </div>
            </div>
            <div id="history-container" class="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <!-- Dynamic content -->
            </div>
        </section>

        <!-- Review Logs Section -->
        <section id="view-review-logs-section" class="hidden">
            <div class="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 class="text-3xl font-headline font-bold text-on-surface mb-2">Review Logs</h2>
                    <p class="text-on-surface-variant text-body-lg max-w-2xl">Logs of administrative reviews and audits.</p>
                </div>
            </div>
            <div id="review-logs-container" class="bg-surface border border-outline-variant rounded-xl overflow-hidden">
                <!-- Dynamic content -->
            </div>
        </section>
`;
    // Insert right before </main>
    adminHtml = adminHtml.replace('</main>', `${sectionInject}\n    </main>`);
}

fs.writeFileSync('public/admin.html', adminHtml);
console.log('admin.html updated.');
