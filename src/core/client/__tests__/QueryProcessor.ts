import {
    getQueryProcessor,
    getFirstItemRequest,
    FIRST_ITEM,
    getAbortError,
    getSecondItemRequest,
    SECOND_ITEM,
    getFirstItemRequestWithOptimisticResponse,
    OPTIMISTIC_FIRST_ITEM,
} from '../../test-utils/request-helpers';

it('can query data', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    const queryResult = queryProcessor.query(firstItemRequest);

    const networkResponse = await queryResult.request;

    const dataFromCache = queryProcessor.getQueryState(firstItemRequest);

    expect(networkResponse).toEqual(FIRST_ITEM);
    expect(dataFromCache).toMatchObject({ data: FIRST_ITEM, error: undefined });
});

it('respects fetch policies', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    let cacheOnlyQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-only',
    });
    expect(cacheOnlyQueryResult.queryState).toMatchObject({ data: undefined, error: undefined });

    let cacheFirstQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-first',
    });
    expect(cacheFirstQueryResult.queryState).toMatchObject({ data: undefined, error: undefined });

    let cacheAndNetworkQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-and-network',
    });
    expect(cacheAndNetworkQueryResult.queryState).toMatchObject({ data: undefined, error: undefined });

    expect(cacheOnlyQueryResult.request).toEqual(undefined);
    await expect(cacheFirstQueryResult.request).resolves.toEqual(FIRST_ITEM);
    await expect(cacheAndNetworkQueryResult.request).resolves.toEqual(FIRST_ITEM);

    cacheOnlyQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-only',
    });
    expect(cacheOnlyQueryResult.queryState).toMatchObject({ data: FIRST_ITEM, error: undefined });

    cacheFirstQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-first',
    });
    expect(cacheFirstQueryResult.queryState).toMatchObject({ data: FIRST_ITEM, error: undefined });

    cacheAndNetworkQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-and-network',
    });
    expect(cacheAndNetworkQueryResult.queryState).toMatchObject({ data: FIRST_ITEM, error: undefined });

    expect(cacheOnlyQueryResult.request).toEqual(undefined);
    expect(cacheFirstQueryResult.request).toEqual(undefined);
    await expect(cacheAndNetworkQueryResult.request).resolves.toEqual(FIRST_ITEM);

    const dataFromCache = queryProcessor.getQueryState({ ...firstItemRequest });

    expect(dataFromCache).toMatchObject({ data: FIRST_ITEM, error: undefined });
});

it('can reuse network requests', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    const firstQueryResult = queryProcessor.query({ ...firstItemRequest });

    expect(queryProcessor.getQueryState({ ...firstItemRequest })).toMatchObject({
        data: undefined,
        error: undefined,
    });

    const secondQueryResult = queryProcessor.query({ ...firstItemRequest });

    expect(queryProcessor.getQueryState({ ...firstItemRequest })).toMatchObject({
        data: undefined,
        error: undefined,
    });

    expect(firstQueryResult.request).toBeDefined();
    expect(secondQueryResult.request).toBeDefined();

    const networkResponse = await Promise.all([firstQueryResult.request, secondQueryResult.request]);

    const firstDataFromCache = queryProcessor.getQueryState({ ...firstItemRequest });
    const secondDataFromCache = queryProcessor.getQueryState({ ...firstItemRequest });

    expect(networkResponse[0]).toEqual(FIRST_ITEM);
    expect(networkResponse[1]).toBe(networkResponse[0]);
    expect(firstDataFromCache).toMatchObject({ data: FIRST_ITEM, error: undefined });
    expect(secondDataFromCache).toMatchObject({ data: FIRST_ITEM, error: undefined });
});

it('can abort network request', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    const abortController = new AbortController();

    const queryResult = queryProcessor.query({ ...firstItemRequest, abortSignal: abortController.signal });

    abortController.abort();

    await expect(queryResult.request).rejects.toEqual(getAbortError());

    const dataFromCache = queryProcessor.getQueryState(firstItemRequest);

    expect(dataFromCache).toMatchObject({ data: undefined, error: getAbortError() });
});

it('can abort network request for multiple requesters', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    const firstAbortController = new AbortController();
    const secondAbortController = new AbortController();

    const firstQueryResult = queryProcessor.query({
        ...firstItemRequest,
        abortSignal: firstAbortController.signal,
    });

    const secondQueryResult = queryProcessor.query({
        ...firstItemRequest,
        abortSignal: secondAbortController.signal,
    });

    firstAbortController.abort();
    secondAbortController.abort();

    await expect(firstQueryResult.request).rejects.toEqual(getAbortError());
    await expect(secondQueryResult.request).rejects.toEqual(getAbortError());

    const dataFromCache = queryProcessor.getQueryState({
        ...firstItemRequest,
        abortSignal: firstAbortController.signal,
    });

    expect(dataFromCache).toMatchObject({ data: undefined, error: getAbortError() });
});

it('does not abort network request if not all requesters asked so', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    const abortController = new AbortController();

    const firstQueryResult = queryProcessor.query({
        ...firstItemRequest,
        abortSignal: abortController.signal,
    });

    const secondQueryResult = queryProcessor.query({ ...firstItemRequest });

    abortController.abort();

    await expect(firstQueryResult.request).resolves.toEqual(FIRST_ITEM);
    await expect(secondQueryResult.request).resolves.toEqual(FIRST_ITEM);

    const dataFromCache = queryProcessor.getQueryState(firstItemRequest);

    expect(dataFromCache).toMatchObject({ data: FIRST_ITEM, error: undefined });
});

it('correctly aborts previous request when the next one is executed immediately with the same id', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();
    const secondItemRequest = getSecondItemRequest();

    const abortController = new AbortController();

    const firstQueryResult = queryProcessor.query({
        ...firstItemRequest,
        getRequestId: () => 'one-and-only',
        abortSignal: abortController.signal,
    });

    abortController.abort();

    const secondQueryResult = queryProcessor.query({ ...secondItemRequest, getRequestId: () => 'one-and-only' });

    await expect(firstQueryResult.request).rejects.toEqual(getAbortError());
    await expect(secondQueryResult.request).resolves.toEqual(SECOND_ITEM);

    const dataFromCache = queryProcessor.getQueryState({
        ...secondItemRequest,
        getRequestId: () => 'one-and-only',
    });

    expect(dataFromCache).toMatchObject({ data: SECOND_ITEM, error: undefined });
});

it('on purge all requests are aborted and do not affect cache anymore', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    const queryResult = queryProcessor.query(firstItemRequest);

    queryProcessor.purge();

    await expect(queryResult.request).rejects.toEqual(getAbortError());

    const dataFromCacheAfterPurge = queryProcessor.getQueryState(firstItemRequest);

    expect(dataFromCacheAfterPurge).toMatchObject({ data: undefined, error: undefined });
});

it('supports optimistic responses', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequestWithOptimisticResponse();

    const queryResult = queryProcessor.query(firstItemRequest);

    expect(queryResult.queryState).toMatchObject({ data: undefined, error: undefined });

    const optimisticDataFromCache = queryProcessor.getQueryState(firstItemRequest);

    expect(optimisticDataFromCache).toMatchObject({ data: OPTIMISTIC_FIRST_ITEM, error: undefined });

    await expect(queryResult.request).resolves.toEqual(FIRST_ITEM);

    const dataFromCache = queryProcessor.getQueryState(firstItemRequest);

    expect(dataFromCache).toMatchObject({ data: FIRST_ITEM, error: undefined });
});

it('does not consider persisted optimistic data / resets persisted loading state', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequestWithOptimisticResponse();

    const queryResult = queryProcessor.query(firstItemRequest);

    expect(queryResult.queryState).toMatchObject({ data: undefined, error: undefined });

    queryProcessor.purge();

    await expect(queryResult.request).rejects.toEqual(getAbortError());

    const optimisticDataFromCache = queryProcessor.getQueryState(firstItemRequest);
    expect(optimisticDataFromCache).toMatchObject({ data: OPTIMISTIC_FIRST_ITEM, error: undefined });

    const cacheFirstQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-first',
    });

    const loadingDataFromCache = queryProcessor.getQueryState({
        ...firstItemRequest,
        fetchPolicy: 'cache-first',
    });
    expect(loadingDataFromCache).toMatchObject({ data: OPTIMISTIC_FIRST_ITEM, error: undefined });

    await expect(cacheFirstQueryResult.request).resolves.toEqual(FIRST_ITEM);

    const dataFromCache = queryProcessor.getQueryState({
        ...firstItemRequest,
        fetchPolicy: 'cache-first',
    });
    expect(dataFromCache).toMatchObject({ data: FIRST_ITEM, error: undefined });
});

it('resets persisted loading state if there is no network request', async () => {
    const queryProcessor = getQueryProcessor();

    const firstItemRequest = getFirstItemRequest();

    const queryResult = queryProcessor.query(firstItemRequest);

    queryProcessor.purge();

    await expect(queryResult.request).rejects.toEqual(getAbortError());

    const loadingDataFromCache = queryProcessor.getQueryState(firstItemRequest);
    expect(loadingDataFromCache).toMatchObject({ data: undefined, error: undefined });

    const cacheOnlyQueryResult = queryProcessor.query({
        ...firstItemRequest,
        fetchPolicy: 'cache-only',
    });

    expect(cacheOnlyQueryResult.request).toEqual(undefined);
    expect(cacheOnlyQueryResult.queryState).toMatchObject({ data: undefined, error: undefined });

    const dataFromCache = queryProcessor.getQueryState({
        ...firstItemRequest,
        fetchPolicy: 'cache-only',
    });
    expect(dataFromCache).toMatchObject({ data: undefined, error: undefined });
});
