import * as React from 'react';
import { useState } from 'react';
import { userQuery } from '../../requests/user';
import { useRichQuery } from '@fetcher/react';

interface Props {
    variant: number;
}

const UserDisplay: React.FC<Props> = ({ variant }) => {
    const [userId, setUserId] = useState(1);

    const { data, error, loading, refetch, abort } = useRichQuery(
        userQuery({
            requestInit: { pathParams: { id: userId } },
            fetchPolicy: variant === 1 ? 'cache-and-network' : variant === 2 ? 'cache-only' : 'no-cache',
            pollInterval: 100,
            lazy: false,
        }),
    );

    console.log('Render', variant, data?.name, error?.message, loading);

    return (
        <div>
            <button onClick={refetch}>Refetch</button>
            <button onClick={abort}>Abort</button>
            <button onClick={() => setUserId((prevId) => prevId + 1)}>Iterate user</button>
            <div>{JSON.stringify(data?.name)}</div>
            <div>{JSON.stringify(loading)}</div>
            <div>
                {JSON.stringify(error?.message)}, {JSON.stringify(error?.response)}, {JSON.stringify(error?.code)}
            </div>
        </div>
    );
};

export { UserDisplay };
