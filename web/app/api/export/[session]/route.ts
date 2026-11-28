import {exportRoute} from '../../../../src/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:Request, context:{params:Promise<{session:string}>}){return exportRoute(request,(await context.params).session)}
