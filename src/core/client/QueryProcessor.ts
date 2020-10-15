import { getAbortController, wireAbortSignals } from '../promise';
import { RequestQueue } from './RequestQueue';
import { BaseRequestHelper } from './BaseRequestHelper';
import { NonUndefined, Query, Cache } from '../types';

export interface QueryState<D extends NonUndefined = null, E extends Error = Error> {
    loading: boolean;
    error?: E | Error; // Regular error can always slip through
    data?: D;
}

export interface QueryResult<R extends NonUndefined, E extends Error> {
    fromCache: QueryState<R, E>;
    request?: Promise<R>;
}

export interface QueryRequest {
    promise?: Promise<any>;
    loading: Set<string>;
    aborted: boolean;
    abort(): void;
}

export interface QueryProcessorOptions<C extends NonUndefined> {
    cache: Cache<C>;
    requestQueue: RequestQueue;
}

export class QueryProcessor<C extends NonUndefined> {
    private ongoingRequests: { [requestId: string]: QueryRequest | undefined } = {};
    private isHydrate = true;
    private readonly cache: Cache<C>;
    private readonly requestQueue: RequestQueue;

    constructor({ cache, requestQueue }: QueryProcessorOptions<C>) {
        this.cache = cache;
        this.requestQueue = requestQueue;
    }

    public onHydrateComplete() {
        this.isHydrate = false;
    }

    public purge() {
        Object.values(this.ongoingRequests).forEach(request => request?.abort());
        this.ongoingRequests = {};
    }

    public getQueryState<R extends NonUndefined, E extends Error, I>(query: Query<C, R, E, I>): QueryState<R, E> {
        const requestId = query.getRequestId(query);
        const { loading, error } = this.cache.getRequestState(requestId);

        return {
            loading: loading.includes(query.requesterId),
            error,
            data: query.fromCache({
                cacheData: this.cache.getCacheData(),
                ...this.getCommonCacheOptions(query, requestId),
            }),
        };
    }

    public query<R extends NonUndefined, E extends Error, I>(query: Query<C, R, E, I>): QueryResult<R, E> {
        const requestId = query.getRequestId(query);
        const requestState = this.getQueryState(query);

        return {
            fromCache: requestState,
            request: this.getRequestPromise(query, requestId, requestState),
        };
    }

    private getRequestPromise<R extends NonUndefined, E extends Error, I>(
        query: Query<C, R, E, I>,
        requestId: string,
        requestState: QueryState<R, E>,
    ): Promise<R> | undefined {
        const isRequestRequired = this.isRequestRequired(query, requestId, requestState);

        if (isRequestRequired) {
            const queryRequest = this.ensureQueryRequest(query, requestId, requestState);

            const onAbort = () => {
                queryRequest.loading.delete(query.requesterId);

                if (queryRequest.loading.size === 0) {
                    queryRequest.abort();
                } else {
                    this.updateCache(query, requestId, { type: 'loading' });
                }
            };

            wireAbortSignals(onAbort, query.abortSignal);

            return queryRequest.promise;
        }

        this.updateCache(query, requestId, { type: 'loading' });

        return undefined;
    }

    private ensureQueryRequest<R extends NonUndefined, E extends Error, I>(
        query: Query<C, R, E, I>,
        requestId: string,
        requestState: QueryState<R, E>,
    ): QueryRequest {
        const currentQueryRequest = this.ongoingRequests[requestId];

        if (!currentQueryRequest || currentQueryRequest.aborted) {
            const abortController = getAbortController();

            const queryRequest: QueryRequest = {
                abort() {
                    abortController?.abort();
                },
                get aborted() {
                    return Boolean(abortController?.signal.aborted);
                },
                loading: new Set([query.requesterId]),
            };

            if (this.isRequestAllowed(query, requestState)) {
                queryRequest.promise = this.requestQueue
                    .addPromise(
                        BaseRequestHelper.getPromiseFactory(query, {
                            abortSignal: abortController?.signal,
                        }),
                        'query',
                    )
                    .then(data => {
                        if (this.ongoingRequests[requestId] === queryRequest) {
                            this.ongoingRequests[requestId] = undefined;

                            this.updateCache(query, requestId, { type: 'success', data });
                        }
                        return data;
                    })
                    .catch(error => {
                        if (this.ongoingRequests[requestId] === queryRequest) {
                            this.ongoingRequests[requestId] = undefined;

                            this.updateCache(query, requestId, { type: 'fail', error });
                        }
                        throw error;
                    });
            }

            this.ongoingRequests[requestId] = queryRequest;

            this.updateCache(query, requestId, { type: 'start' });
        } else {
            currentQueryRequest.loading.add(query.requesterId);

            this.updateCache(query, requestId, { type: 'loading' });
        }

        return this.ongoingRequests[requestId]!;
    }

    private updateCache<R extends NonUndefined, E extends Error, I>(
        query: Query<C, R, E, I>,
        requestId: string,
        action: { type: 'loading' } | { type: 'start' } | { type: 'fail'; error: E } | { type: 'success'; data: R },
    ) {
        this.cache.updateState({
            updateRequestState: {
                requestId,
                update: requestState => {
                    const newError =
                        action.type !== 'fail'
                            ? action.type !== 'success'
                                ? requestState.error
                                : undefined
                            : action.error;

                    const currentLoading = [...(this.ongoingRequests[requestId]?.loading ?? [])];
                    const newLoading =
                        currentLoading.length === requestState.loading.length &&
                        currentLoading.every(id => requestState.loading.includes(id))
                            ? requestState.loading
                            : currentLoading;

                    return requestState.error === newError && requestState.loading === newLoading
                        ? requestState
                        : {
                              error: newError,
                              loading: newLoading,
                          };
                },
            },
            updateCacheData:
                action.type !== 'loading'
                    ? cacheData => {
                          if (action.type === 'start') {
                              return query.optimisticData
                                  ? query.toCache({
                                        cacheData,
                                        data: query.optimisticData,
                                        ...this.getCommonCacheOptions(query, requestId),
                                    })
                                  : cacheData;
                          } else if (action.type === 'fail') {
                              return query.optimisticData && query.removeOptimisticData
                                  ? query.removeOptimisticData({
                                        cacheData,
                                        data: query.optimisticData,
                                        ...this.getCommonCacheOptions(query, requestId),
                                    })
                                  : cacheData;
                          } else {
                              return query.toCache({
                                  cacheData:
                                      query.optimisticData && query.removeOptimisticData
                                          ? query.removeOptimisticData({
                                                cacheData: cacheData,
                                                data: query.optimisticData,
                                                ...this.getCommonCacheOptions(query, requestId),
                                            })
                                          : cacheData,
                                  data: action.data,
                                  ...this.getCommonCacheOptions(query, requestId),
                              });
                          }
                      }
                    : undefined,
        });
    }

    private isRequestRequired<R extends NonUndefined, E extends Error, I>(
        query: Query<C, R, E, I>,
        requestId: string,
        requestState: QueryState<R, E>,
    ): boolean {
        return !(
            query.fetchPolicy === 'cache-only' ||
            (query.fetchPolicy === 'cache-first' && this.isRequestStateSufficient(query, requestId, requestState)) ||
            (query.preventExcessRequestOnHydrate &&
                this.isHydrate &&
                this.isRequestStateSufficient(query, requestId, requestState))
        );
    }

    private isRequestAllowed<R extends NonUndefined, E extends Error, I>(
        query: Query<C, R, E, I>,
        requestState: QueryState<R, E>,
    ): boolean {
        return (
            typeof window !== 'undefined' ||
            (!query.disableSsr && requestState.data === undefined && requestState.error === undefined)
        );
    }

    private isRequestStateSufficient<R extends NonUndefined, E extends Error, I>(
        query: Query<C, R, E, I>,
        requestId: string,
        requestState: QueryState<R, E>,
    ): boolean {
        return (
            requestState.data !== undefined &&
            !query.isOptimisticData?.({
                data: requestState.data,
                cacheData: this.cache.getCacheData(),
                ...this.getCommonCacheOptions(query, requestId),
            })
        );
    }

    private getCommonCacheOptions<R extends NonUndefined, E extends Error, I>(
        query: Query<C, R, E, I>,
        requestId: string,
    ) {
        return {
            requestInit: query.requestInit,
            requestId,
            requesterId: query.requesterId,
        };
    }
}
