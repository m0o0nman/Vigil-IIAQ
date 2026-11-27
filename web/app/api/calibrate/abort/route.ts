import {ownerRoute} from '../../../../src/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){return ownerRoute(request, 'abort')}
