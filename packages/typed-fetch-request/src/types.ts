import { StringifiableRecord } from 'query-string';
import { CustomData } from './CustomData';

type UndefinedPropertyOf<T> = {
    [K in keyof T]: undefined extends T[K] ? K : never;
}[keyof T];

type PartialUndefined<T> = Partial<T> & Omit<T, UndefinedPropertyOf<T>>;

export type PathConstraint = Record<string, string | number> | undefined;
export type QueryConstraint = StringifiableRecord | undefined;
export type HeadersConstraint = HeadersInit | undefined;
export type BodyConstraint = CustomData<any> | BodyInit | null | undefined;

export type FetchRequestInitParams = {
    P?: PathConstraint | undefined;
    Q?: QueryConstraint | undefined;
    H?: HeadersConstraint | undefined;
    B?: BodyConstraint | undefined;
};

export type DynamicFetchRequestInit<C extends FetchRequestInitParams = FetchRequestInitParams> = PartialUndefined<
    Omit<RequestInit, 'body' | 'headers'> & {
        pathParams: unknown extends C['P'] ? PathConstraint : C['P'];
        queryParams: unknown extends C['Q'] ? QueryConstraint : C['Q'];
        headers: unknown extends C['H'] ? HeadersConstraint : C['H'];
        body: unknown extends C['B'] ? BodyConstraint : C['B'];
    }
>;

export type StaticFetchRequestInit = {
    root?: string;
    path: string;
};

export type FetchRequestInit<C extends FetchRequestInitParams = FetchRequestInitParams> = DynamicFetchRequestInit<C> &
    StaticFetchRequestInit;
