const fs = require('fs');

let studentHtml = fs.readFileSync('public/student.html', 'utf8');

// 1. Inject view-manager.js
if (!studentHtml.includes('view-manager.js')) {
    studentHtml = studentHtml.replace('<script src="js/ui-components.js"></script>', '<script src="js/ui-components.js"></script>\n    <script src="js/view-manager.js"></script>');
}

// 2. Add Desktop Nav Item: Task Progress
if (!studentHtml.includes('id="nav-task-progress"')) {
    const taskNavStr = '<button id="nav-tasks" class="nav-item w-full flex items-center gap-3 px-6 py-4 text-secondary-fixed-dim font-normal font-headline text-body-sm hover:bg-on-secondary-container hover:text-inverse-on-surface transition-colors cursor-pointer transition-all duration-150 text-left">\n                <span class="material-symbols-outlined text-[20px]">assignment</span>\n                Pending Tasks\n            </button>';
    const taskProgressNavStr = `<button id="nav-task-progress" class="nav-item w-full flex items-center gap-3 px-6 py-4 text-secondary-fixed-dim font-normal font-headline text-body-sm hover:bg-on-secondary-container hover:text-inverse-on-surface transition-colors cursor-pointer transition-all duration-150 text-left">
                <span class="material-symbols-outlined text-[20px]">pending_actions</span>
                Task Progress
            </button>`;
    studentHtml = studentHtml.replace(taskNavStr, `${taskNavStr}\n            ${taskProgressNavStr}`);
}

// 3. Add Mobile Nav Item: Task Progress
if (!studentHtml.includes('id="mobile-nav-task-progress"')) {
    const mobTaskNavStr = '<button id="mobile-nav-tasks" class="mobile-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container transition-colors text-left">\n                            <span class="material-symbols-outlined text-[20px]">assignment</span>\n                            Pending Tasks\n                        </button>';
    const mobTaskProgressNavStr = `<button id="mobile-nav-task-progress" class="mobile-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-DEFAULT text-secondary-fixed-dim font-normal hover:bg-on-secondary-container transition-colors text-left">
                            <span class="material-symbols-outlined text-[20px]">pending_actions</span>
                            Task Progress
                        </button>`;
    studentHtml = studentHtml.replace(mobTaskNavStr, `${mobTaskNavStr}\n                        ${mobTaskProgressNavStr}`);
}

// 4. Add Section Container
if (!studentHtml.includes('id="view-task-progress-section"')) {
    const sectionInject = `</section>\n\n        <!-- Task Progress Section -->\n        <section id="view-task-progress-section" class="hidden">\n            <div class="mb-8">\n                <h2 class="text-3xl font-headline font-bold text-on-surface mb-2">Task Progress</h2>\n                <p class="text-on-surface-variant text-body-lg max-w-2xl">Track tasks that you have started but not yet completed.</p>\n            </div>\n            <div id="task-progress-container" class="bg-surface border border-outline-variant rounded-xl overflow-hidden">\n                <!-- Dynamic content -->\n            </div>\n        </section>`;
    
    studentHtml = studentHtml.replace('</section>\n\n        <!-- Completed Tasks Section -->', `${sectionInject}\n\n        <!-- Completed Tasks Section -->`);
}

fs.writeFileSync('public/student.html', studentHtml);
console.log('student.html updated.');
