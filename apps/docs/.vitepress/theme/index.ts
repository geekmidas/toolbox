import mediumZoom from 'medium-zoom';
import { useRoute } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import { nextTick, onMounted, watch } from 'vue';
import './custom.css';

export default {
	extends: DefaultTheme,
	setup() {
		const route = useRoute();

		// Click-to-zoom for content images. The architecture exports are 2560px
		// wide against a ~700px content column, so without this they are only
		// ever seen at a third of their detail.
		const initZoom = () => {
			mediumZoom('.vp-doc img', { background: 'var(--vp-c-bg)' });
		};

		onMounted(initZoom);
		watch(
			() => route.path,
			() => nextTick(initZoom),
		);
	},
};
