import { RelativeFilePath } from "@fern-api/fs-utils";
import { ts } from "ts-morph";
import { CoreUtility } from "../CoreUtility";
import { CallbackQueue } from "./CallbackQueue";

export class CallbackQueueImpl extends CoreUtility implements CallbackQueue {
    public readonly MANIFEST = {
        name: "callback-queue",
        repoInfoForTesting: {
            path: RelativeFilePath.of("packages/core-utilities/callback-queue/src"),
            ignoreGlob: "**/__test__",
        },
        originalPathOnDocker: "/assets/callback-queue" as const,
        pathInCoreUtilities: [{ nameOnDisk: "callback-queue", exportDeclaration: { exportAll: true } }],
    };

    public readonly _instantiate = this.withExportedName(
        "CallbackQueue",
        (CallbackQueue) => () => ts.factory.createNewExpression(CallbackQueue.getExpression(), undefined, undefined)
    );

    public readonly wrap = ({
        referenceToCallbackQueue,
        functionToWrap,
    }: {
        referenceToCallbackQueue: ts.Expression;
        functionToWrap: ts.Expression;
    }): ts.Expression => {
        return ts.factory.createCallExpression(
            ts.factory.createPropertyAccessExpression(referenceToCallbackQueue, "wrap"),
            undefined,
            [functionToWrap]
        );
    };
}
