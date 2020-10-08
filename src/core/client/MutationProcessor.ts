import { NonUndefined, YarfRequest } from '../request';
import * as logger from '../logger';
import { MultiAbortController, MultiAbortSignal } from '../promise/controllers';
import { wireAbortSignals } from '../promise/helpers';
import { Cache } from '../cache';
import { NetworkRequestQueue } from './NetworkRequestQueue';

export interface MutateOptions {
    requesterId: string;
    multiAbortSignal?: MultiAbortSignal;
}

export interface MutationPromiseData {
    promise: Promise<any>;
    aborted: boolean;
    abort(): void;
}

export interface MutationProcessorOptions<C extends NonUndefined> {
    cache: Cache<C>;
    networkRequestQueue: NetworkRequestQueue<C>;
}

export class MutationProcessor<C extends NonUndefined> {
    private mutations: Set<MutationPromiseData> = new Set();
    private readonly cache: Cache<C>;
    private networkRequestQueue: NetworkRequestQueue<C>;

    constructor({ cache, networkRequestQueue }: MutationProcessorOptions<C>) {
        this.cache = cache;
        this.networkRequestQueue = networkRequestQueue;
    }

    public purge() {
        this.mutations.forEach(mutation => mutation.abort());
        this.mutations.clear();
    }

    public async mutate<R extends NonUndefined, E extends Error, I>(
        request: YarfRequest<C, R, E, I>,
        { multiAbortSignal, requesterId }: MutateOptions,
    ): Promise<R> {
        const requestId = request.getId(request.requestInit);

        if (request.optimisticResponse !== undefined && request.clearCacheFromOptimisticResponse) {
            this.cache.updateState({
                cacheData: request.toCache({
                    cacheData: this.cache.getData(),
                    responseData: request.optimisticResponse,
                    requestInit: request.requestInit,
                    requestId,
                    requesterId,
                }),
            });
        } else if (request.optimisticResponse !== undefined) {
            logger.warn("Optimistic response won't work without clearCacheFromOptimisticResponse function");
        }

        const multiAbortController = new MultiAbortController();

        const mutationPromiseData: MutationPromiseData = {
            promise: Promise.resolve(),
            abort() {
                multiAbortController.abort();
            },
            get aborted() {
                return Boolean(multiAbortController.signal.aborted);
            },
        };

        // eslint-disable-next-line @typescript-eslint/unbound-method
        wireAbortSignals(mutationPromiseData.abort, multiAbortSignal);

        const mutationPromise = this.networkRequestQueue
            .getRequestPromise(request, { multiAbortSignal: multiAbortController.signal })
            .then(data => {
                // Delay state update to let all planned state updates finish
                return data;
            })
            .then(data => {
                if (this.mutations.has(mutationPromiseData)) {
                    this.mutations.delete(mutationPromiseData);

                    let cacheData = this.cache.getData();

                    if (request.optimisticResponse !== undefined && request.clearCacheFromOptimisticResponse) {
                        cacheData = request.clearCacheFromOptimisticResponse({
                            cacheData: cacheData,
                            optimisticResponseData: request.optimisticResponse,
                            requestInit: request.requestInit,
                            requestId,
                            requesterId,
                        });
                    }

                    this.cache.updateState({ cacheData });
                }

                return data;
            })
            .catch(error => {
                if (this.mutations.has(mutationPromiseData)) {
                    this.mutations.delete(mutationPromiseData);

                    if (request.optimisticResponse !== undefined && request.clearCacheFromOptimisticResponse) {
                        const cacheData = this.cache.getData();

                        this.cache.updateState({
                            cacheData: request.clearCacheFromOptimisticResponse({
                                cacheData: cacheData,
                                optimisticResponseData: request.optimisticResponse,
                                requestInit: request.requestInit,
                                requestId,
                                requesterId,
                            }),
                        });
                    }
                }

                throw error;
            });

        mutationPromiseData.promise = mutationPromise;

        this.mutations.add(mutationPromiseData);

        return mutationPromise;
    }
}
