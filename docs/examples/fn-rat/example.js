export async function shouldRatify(pub) {
  const meta = pub?.value?.meta || {};
  const schema = typeof meta.schema === "string" ? meta.schema : "";
  const tags = Array.isArray(meta.tags) ? meta.tags : [];

  const schemaMatch = schema === "mesh/example/fn-pub/v1";
  const priorityTag = tags.includes("priority:high");
  return schemaMatch || priorityTag;
}

export default shouldRatify;
