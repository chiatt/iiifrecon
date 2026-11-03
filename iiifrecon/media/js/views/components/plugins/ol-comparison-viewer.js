import ko from 'knockout';
import { createVueApplication } from '@/arches_vue_components/application';

import OlComparisonViewer from '@/iiifrecon/plugins/OlComparisonViewer.vue';
import OlComparisonViewerTemplate from 'templates/views/components/plugins/ol-comparison-viewer.htm';

export default ko.components.register('ol-comparison-viewer', {
    viewModel: function () {
        createVueApplication({ component: OlComparisonViewer }).then(vueApp => {
            vueApp.mount('#ol-comparison-viewer-mounting-point');
        });
    },
    template: OlComparisonViewerTemplate,
});
