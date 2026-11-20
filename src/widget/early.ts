// The widget page's first script: widget/index.html loads it ahead of the client (vite.widget.config.ts).
import {startEarlyWorker} from '@/widget/earlyWorker';

startEarlyWorker();
