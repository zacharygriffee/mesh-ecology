/**
 * @import { HashPort } from "../core/crypto/hashport.js"
 */

/**
 * Platform services required by mesh-sdk core.
 *
 * `nowMs` is required to preserve timeout/elapsed behavior in
 * `waitForMaterialization` without changing external API semantics.
 *
 * @typedef {object} MeshRuntimeOps
 * @property {(storeRoot: string) => any} ensureCorestore
 * @property {(cs: any, config?: object, swarm?: any) => Promise<any>} ensureDiscoverySurface
 * @property {(cs: any, swarm?: any, config?: object) => Promise<any>} ensureConcernSurface
 * @property {(base: any) => any} getJobView
 * @property {(base: any) => any} getPublishView
 * @property {(base: any) => any} getRatView
 * @property {(base: any, jobKey: Buffer, cap: string, ref: object, meta?: any) => Promise<void>} publishJobWork
 * @property {(base: any, jobKey: Buffer, orgKey: Buffer, attempt: Buffer, determination: number, tier: number, cap: string, ref: object, note?: string) => Promise<void>} publishJobRatification
 * @property {{ CONCERN: number }} KIND
 *
 * @typedef {object} MeshPlatform
 * @property {(storeRoot: string) => string} resolveStoreRoot Resolve caller-provided store root into platform-specific canonical form.
 * @property {() => Promise<MeshRuntimeOps>} loadMeshRuntime Load concern/discovery/corestore operations for this runtime.
 * @property {(ms: number, signal?: AbortSignal) => Promise<void>} sleep Delay helper used by polling/wait loops.
 * @property {() => number} nowMs Monotonic-enough wall clock in milliseconds for timeout/elapsed calculations.
 * @property {(task: () => (void | Promise<void>), intervalMs: number) => (() => void)} scheduleInterval Schedule recurring work and return a cleanup function.
 * @property {HashPort} [hashPort] Default HashPort for this runtime.
 */

export {};
