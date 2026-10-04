// The retired viewer is no longer a supported write surface. Historical data
// remains available in snapshots and is never removed by this route.
export async function PATCH() {
  return Response.json({ error: "This annotation API is retired. Use the shared PDF workspace." }, { status: 410 });
}
