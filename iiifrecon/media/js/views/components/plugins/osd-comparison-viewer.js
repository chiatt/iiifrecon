import ko from 'knockout';
import { createVueApplication } from '@/arches_vue_components/application';

import OsdComparisonViewer from '@/iiifrecon/plugins/OsdComparisonViewer.vue';
import OsdComparisonViewerTemplate from 'templates/views/components/plugins/osd-comparison-viewer.htm';

export default ko.components.register('osd-comparison-viewer', {
    viewModel: function () {
        createVueApplication({ component: OsdComparisonViewer }).then(vueApp => {
            vueApp.mount('#osd-comparison-viewer-mounting-point');
        });
    },
    template: OsdComparisonViewerTemplate,
});
