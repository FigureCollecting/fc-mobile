// The production build behind real nginx, in a container. Until WK-09 ships
// the fc-mobile-web image this is the stock unprivileged image plus the
// stand-in config; pass `image` to run the built fc-mobile-web instead.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

export const DEFAULT_WEB_IMAGE = 'nginxinc/nginx-unprivileged:1.30-alpine';
export const DEFAULT_NGINX_CONF = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'nginx', 'default.conf');
const PORT = 8080;

export interface WebOptions {
  /** The built PWA (vite build output). Ignored when `image` is set. */
  dist?: string;
  /** A prebuilt image that serves the PWA itself on :8080. */
  image?: string;
  nginxConf?: string;
}

export interface StackWeb {
  image: string;
  url: string;
  stop(): Promise<void>;
  start(): Promise<void>;
}

export async function startWeb(options: WebOptions): Promise<StackWeb> {
  const image = options.image ?? DEFAULT_WEB_IMAGE;
  if (options.image === undefined) {
    if (options.dist === undefined || !existsSync(path.join(options.dist, 'index.html'))) {
      throw new Error(`no index.html in ${options.dist ?? '(unset)'}; run npm run build at the repo root first`);
    }
  }

  const build = (): GenericContainer => {
    let container = new GenericContainer(image).withExposedPorts(PORT).withWaitStrategy(Wait.forHttp('/', PORT));
    if (options.image === undefined) {
      container = container
        .withCopyDirectoriesToContainer([{ source: options.dist as string, target: '/usr/share/nginx/html' }])
        .withCopyFilesToContainer([
          { source: options.nginxConf ?? DEFAULT_NGINX_CONF, target: '/etc/nginx/conf.d/default.conf' },
        ]);
    }
    return container;
  };

  let started: StartedTestContainer | undefined = await build().start();
  let url = `http://${started.getHost()}:${started.getMappedPort(PORT)}`;

  return {
    image,
    get url() {
      return url;
    },
    stop: async () => {
      const current = started;
      started = undefined;
      await current?.stop();
    },
    start: async () => {
      if (started !== undefined) return;
      started = await build().start();
      url = `http://${started.getHost()}:${started.getMappedPort(PORT)}`;
    },
  };
}
