export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json(
      { error: { message: 'ANTHROPIC_API_KEY is not configured on the server.' } },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model,
        max_tokens: body.max_tokens || 8000,
        system: body.system,
        messages: body.messages,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return Response.json(
        { error: data.error || { message: 'Anthropic API error' } },
        { status: resp.status }
      );
    }

    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: { message: err.message || 'Internal server error' } },
      { status: 500 }
    );
  }
}
