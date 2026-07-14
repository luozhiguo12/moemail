import Cloudflare from "cloudflare";
import "dotenv/config";

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN;
const PROJECT_NAME = process.env.PROJECT_NAME || "moemail";
const DATABASE_NAME = process.env.DATABASE_NAME || "moemail-db";
const KV_NAMESPACE_NAME = process.env.KV_NAMESPACE_NAME || "moemail-kv";
const DATABASE_ID = process.env.DATABASE_ID;

const client = new Cloudflare({
  apiToken: CF_API_TOKEN,
});

export const getPages = async () => {
  const projectInfo = await client.pages.projects.get(PROJECT_NAME, {
    account_id: CF_ACCOUNT_ID,
  });

  return projectInfo;
};

export const createPages = async () => {
  console.log(`🆕 Creating new Cloudflare Pages project: "${PROJECT_NAME}"`);

  const project = await client.pages.projects.create({
    account_id: CF_ACCOUNT_ID,
    name: PROJECT_NAME,
    production_branch: "main",
  });

  if (CUSTOM_DOMAIN) {
    console.log("🔗 Setting pages domain...");

    await client.pages.projects.domains.create(PROJECT_NAME, {
      account_id: CF_ACCOUNT_ID,
      name: CUSTOM_DOMAIN,
    });

    console.log("✅ Pages domain set successfully");
  }

  console.log("✅ Project created successfully");

  return project;
};

export const ensurePagesDomain = async () => {
  if (!CUSTOM_DOMAIN) return;

  const domainUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/domains/${CUSTOM_DOMAIN}`;
  const headers = { Authorization: `Bearer ${CF_API_TOKEN}` };
  const existingDomain = await fetch(domainUrl, { headers });

  if (existingDomain.ok) {
    console.log(`Pages domain "${CUSTOM_DOMAIN}" already exists`);
  } else if (existingDomain.status !== 404) {
    throw new Error(`Failed to check Pages domain: ${existingDomain.status} ${await existingDomain.text()}`);
  } else {
    console.log(`Setting Pages domain "${CUSTOM_DOMAIN}"...`);
    const createDomain = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${PROJECT_NAME}/domains`,
      {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: CUSTOM_DOMAIN }),
      },
    );

    if (!createDomain.ok) {
      throw new Error(`Failed to create Pages domain: ${createDomain.status} ${await createDomain.text()}`);
    }

    console.log("Pages domain set successfully");
  }

  const zonesResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones?account.id=${CF_ACCOUNT_ID}&per_page=50`,
    { headers },
  );
  if (!zonesResponse.ok) {
    throw new Error(`Failed to list DNS zones: ${zonesResponse.status} ${await zonesResponse.text()}`);
  }

  const zones = await zonesResponse.json() as { result: Array<{ id: string; name: string }> };
  const zone = zones.result
    .filter(({ name }) => CUSTOM_DOMAIN === name || CUSTOM_DOMAIN.endsWith(`.${name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone) {
    throw new Error(`No Cloudflare DNS zone found for "${CUSTOM_DOMAIN}"`);
  }

  const recordsResponse = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records?name=${CUSTOM_DOMAIN}`,
    { headers },
  );
  if (!recordsResponse.ok) {
    throw new Error(`Failed to check DNS records: ${recordsResponse.status} ${await recordsResponse.text()}`);
  }

  const records = await recordsResponse.json() as { result: Array<{ type: string; content: string }> };
  const target = `${PROJECT_NAME}.pages.dev`;
  if (records.result.some(record => record.type === "CNAME" && record.content === target)) {
    console.log(`Pages DNS record for "${CUSTOM_DOMAIN}" already exists`);
    return;
  }
  const conflictingRecords = records.result.filter(record => ["A", "AAAA", "CNAME"].includes(record.type));
  if (conflictingRecords.length > 0) {
    throw new Error(`Refusing to replace existing DNS records for "${CUSTOM_DOMAIN}"`);
  }

  const createRecord = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zone.id}/dns_records`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "CNAME",
        name: CUSTOM_DOMAIN,
        content: target,
        proxied: true,
        ttl: 1,
      }),
    },
  );
  if (!createRecord.ok) {
    throw new Error(`Failed to create Pages DNS record: ${createRecord.status} ${await createRecord.text()}`);
  }

  console.log(`Pages DNS record created for "${CUSTOM_DOMAIN}"`);
};

export const getDatabase = async () => {
  if (DATABASE_ID) {
    return {
      uuid: DATABASE_ID,
    }
  }

  const database = await client.d1.database.get(DATABASE_NAME, {
    account_id: CF_ACCOUNT_ID,
  });

  return database;
};

export const createDatabase = async () => {
  console.log(`🆕 Creating new D1 database: "${DATABASE_NAME}"`);

  const database = await client.d1.database.create({
    account_id: CF_ACCOUNT_ID,
    name: DATABASE_NAME,
  });

  console.log("✅ Database created successfully");

  return database;
};

export const getKVNamespaceList = async () => {
  const kvNamespaces = [];

  for await (const namespace of client.kv.namespaces.list({
    account_id: CF_ACCOUNT_ID,
  })) {
    kvNamespaces.push(namespace);
  }

  return kvNamespaces;
};

export const createKVNamespace = async () => {
  console.log(`🆕 Creating new KV namespace: "${KV_NAMESPACE_NAME}"`);

  const kvNamespace = await client.kv.namespaces.create({
    account_id: CF_ACCOUNT_ID,
    title: KV_NAMESPACE_NAME,
  });

  console.log("✅ KV namespace created successfully");

  return kvNamespace;
};
