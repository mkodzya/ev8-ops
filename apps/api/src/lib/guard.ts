// Route guard. Every route declares a scope in its config:
//   'public'        — no session needed (login, health)
//   'session'       — any active, logged-in user
//   <Permission>    — a permission from @ev8/shared; the role decides
// A route that declares NOTHING is treated as owner-only ('users.manage'),
// default-deny. The onRoute hook collects every route into app.routeTable so
// a test can sweep it; there is no hand-maintained route list anywhere.

import { PERMISSIONS, type Permission } from '@ev8/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, hasPerm, loadActor, type Actor } from './auth.js';

export type RouteScope = 'public' | 'session' | Permission;
const DEFAULT_SCOPE: RouteScope = 'users.manage';

export interface RouteInfo {
  method: string;
  url: string;
  scope: RouteScope;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    scope?: RouteScope;
  }
  interface FastifyRequest {
    actor: Actor | null;
  }
  interface FastifyInstance {
    routeTable: RouteInfo[];
  }
}

function scopeOf(config: { scope?: RouteScope } | undefined): RouteScope {
  const scope = config?.scope ?? DEFAULT_SCOPE;
  if (scope !== 'public' && scope !== 'session' && !PERMISSIONS.includes(scope)) {
    throw new Error(`route declares an unknown scope: ${String(scope)}`);
  }
  return scope;
}

export function installGuard(app: FastifyInstance): void {
  app.decorate('routeTable', [] as RouteInfo[]);
  app.decorateRequest('actor', null);

  app.addHook('onRoute', (route) => {
    const scope = scopeOf(route.config as { scope?: RouteScope } | undefined);
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      app.routeTable.push({ method, url: route.url, scope });
    }
  });

  // onRequest runs before body parsing, so a refused request costs nothing.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const scope = scopeOf(req.routeOptions?.config as { scope?: RouteScope } | undefined);
    req.actor = await loadActor(req.cookies?.[SESSION_COOKIE]);
    if (scope === 'public') return;
    if (!req.actor) return reply.code(401).send({ error: 'unauthenticated' });
    if (scope === 'session') return;
    if (!hasPerm(req.actor, scope)) {
      return reply.code(403).send({ error: 'forbidden', permission: scope, role: req.actor.role });
    }
  });
}

/** For handlers: the actor is guaranteed by the guard on non-public scopes. */
export function actorOf(req: FastifyRequest): Actor {
  if (!req.actor) throw new Error('actor missing — route scope misconfigured');
  return req.actor;
}
