export default {
  async fetch(request, env) {
    const DEFAULT_DOCKER_REGISTRY_URL = env.DEFAULT_DOCKER_REGISTRY_URL || 'https://index.docker.io';
    const DEFAULT_DOCKER_REGISTRY_AUTH_URL = env.DEFAULT_DOCKER_REGISTRY_AUTH_URL || 'https://auth.docker.io/token';
    const DEFAULT_DOCKER_SERVICE = env.DEFAULT_DOCKER_SERVICE ?? 'registry.docker.io';
    const GET_TOKEN_BY_CF = env.GET_TOKEN_BY_CF ?? true;

    const url = new URL(request.url);

    let upstream;
    const ipv4Pattern = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    const ipv6Pattern = /^([[:xdigit:]]{1,4}(?::[[:xdigit:]]{1,4}){7}|::|:(?::[[:xdigit:]]{1,4}){1,6}|[[:xdigit:]]{1,4}:(?::[[:xdigit:]]{1,4}){1,5}|(?:[[:xdigit:]]{1,4}:){2}(?::[[:xdigit:]]{1,4}){1,4}|(?:[[:xdigit:]]{1,4}:){3}(?::[[:xdigit:]]{1,4}){1,3}|(?:[[:xdigit:]]{1,4}:){4}(?::[[:xdigit:]]{1,4}){1,2}|(?:[[:xdigit:]]{1,4}:){5}:[[:xdigit:]]{1,4}|(?:[[:xdigit:]]{1,4}:){1,6}:)$/
    const subDomainVSUpstreamDomain = {
      'hub': DEFAULT_DOCKER_REGISTRY_URL,

      "quay": "https://quay.io",
      "gcr": "https://gcr.io",
      "k8s-gcr": "https://k8s.gcr.io",
      "k8s": "https://registry.k8s.io",
      "ghcr": "https://ghcr.io",
      "cloudsmith": "https://docker.cloudsmith.io",
      "ecr": "https://public.ecr.aws",

      'docker-staging': DEFAULT_DOCKER_REGISTRY_URL
    };
    if (url.hostname.match(ipv4Pattern) || url.hostname.match(ipv6Pattern)) {
      // 使用默认的 docker registry
      upstream = DEFAULT_DOCKER_REGISTRY_URL;
    } else {
      upstream = subDomainVSUpstreamDomain[url.hostname.split('.')[0]] ?? "";
    }

    console.log(`访问 cf 链接(${url}) 将会真实访问到域名 ${upstream}(具体的真实访问链接后面给出)`);

    if (upstream === "") {
      return new Response(
        JSON.stringify({
          subDomainVSUpstreamDomain
        }),
        {
          status: 404,
        },
      );
    }

    /*
      /auth 使用 cf 来代理获取 token
      /v2/xxx/blobs/xxxxxxxx 或者 /v2/xxxx/manifests/xxxxx 那么就重定向到 /v2/library/xxx/blobs/xxxxxxxx 或者 /v2/library/xxxx/manifests/xxxxx
      /v2/xxxxxx 直接访问 upstream/v2/xxxxxx
        如果遇到 401
          1 返回 cf bearer
            优势是不怕 auth.docker.io/token 无法访问，
            并且能够借助 cf 的节点 ip 不停在变的优势，间接突破 ip 访问限制
            使用环境变量 GET_TOKEN_BY_CF = true 来开启这个功能
          2 返回 upstream 的 bearer
            优势是如果本地 login 了（如果能够 login 的话，我没有测试过），访问限制就是你的用户限制，而不是 ip 限制了
            还是推荐使用这个方法，毕竟 auth.docker.io/token 可以访问，登录了自己的账号，也能够访问自己的非公开镜像
      其他的/xxxxx，直接访问 upstream/xxxx
    */
    let upstreamURL;
    if (url.pathname.startsWith('/auth')) {
      console.log(`request params are: ${url.searchParams}`)
      const upstreamRealm = url.searchParams.get('upstreamRealm') ?? DEFAULT_DOCKER_REGISTRY_AUTH_URL;
      const service = url.searchParams.get('service') ?? DEFAULT_DOCKER_SERVICE;
      let scope = url.searchParams.get('scope');

      if (scope) {
        const repoPattern = /repository:(?<repo>[^:]+):/
        const repoName = scope.match(repoPattern)?.groups.repo
        if (repoName) {
          if (!repoName.includes('/')) {
            scope = scope.replace(`:${repoName}:`, `:library/${repoName}:`)
            console.log(`在获取 token 的时候，发现 repoName(${repoName}) 格式不对；将会将 scope 修改为 ${scope}`)
            url.searchParams.delete('scope')
            url.searchParams.append('scope', scope)
            return Response.redirect(url, 301)
          }
        }
      }

      upstreamURL = new URL(upstreamRealm);
      upstreamURL.searchParams.set('service', service);
      if (scope) upstreamURL.searchParams.set('scope', scope);
    } else {
      upstreamURL = new URL(upstream + url.pathname + url.search);
    }

    const pathParts = url.pathname.split('/');
    const v2Index = pathParts.indexOf('v2');
    const manifestsIndex = pathParts.indexOf('manifests');
    const blobsIndex = pathParts.indexOf('blobs');
    if (v2Index !== -1) {
      const _index = manifestsIndex === -1 ? blobsIndex : manifestsIndex;
      if (_index !== -1) {
        if (pathParts.slice(v2Index + 1, _index).length === 1) {
          // 没有 repo, 添加 library 这个 repo
          pathParts.splice(v2Index + 1, 0, 'library');
          const redirectURL = new URL(url.origin + pathParts.join('/') + url.search);
          return Response.redirect(redirectURL, 301);
        }
      }
    }

    console.log(`访问 cf(${url}) 即将访问真实的链接 ${upstreamURL}`);
    console.log(`访问 cf 时带的 authorization header 是 ${request.headers.get('authorization')}`);

    let upstreamResponse = await justForward(upstreamURL, request);

    console.log(`已经成功访问了 ${upstreamURL}`)

    // https://index.docker.io/v2/jellyfin/jellyfin/manifests/latest
    // https://auth.docker.io
    // https://auth.docker.io/token?scope=repository%3Ajellyfin%2Fjellyfin%3Apull&service=registry.docker.io

    // console.log(`status is: ${upstreamResponse.status}; ${(await upstreamResponse).statusText}`)


    if (url.pathname.startsWith('/v2')) {
      if (upstreamResponse.status === 401) {
        console.log(`访问 upstream（${url}）时需要重新获取 token`)

        if (GET_TOKEN_BY_CF) {
          // Bearer realm="https://dockerproxy.cn/token",service="registry.docker.io",scope="repository:jellyfin/jellyfin:pull"
          const realmPattern = /realm[^=]*=[^"']*["'](?<realm>[^"']+)["']/;
          const servicePattern = /service[^=]*=[^"']*["'](?<service>[^"']+)["']/;
          const scopePattern = /scope[^=]*=[^"']*["'](?<scope>[^"']+)["']/;

          const wwwAuthenticate = upstreamResponse.headers.get('www-authenticate') ?? '';
          console.log(`wwwAuthenticate is ${wwwAuthenticate}; ${typeof wwwAuthenticate}`)

          const realm = wwwAuthenticate.match(realmPattern)?.groups.realm ?? DEFAULT_DOCKER_REGISTRY_AUTH_URL;
          // console.log(`realm/service/scope: ${realm}/${service}/${scope}`)

          const service = wwwAuthenticate.match(servicePattern)?.groups.service ?? DEFAULT_DOCKER_SERVICE;
          // console.log(`realm/service/scope: ${realm}/${service}/${scope}`)

          const scope = wwwAuthenticate.match(scopePattern)?.groups.scope;
          console.log(`realm/service/scope: ${realm}/${service}/${scope}`)

          const bearer = `Bearer realm="http://${url.host}/auth",service="${service}",upstreamRealm="${realm}"` + (scope ? `,scope="${scope}"` : '');
          const headers = new Headers({ 'www-authenticate': bearer });

          console.log(`尝试返回 cf token 申请链接(${bearer})`);
          return new Response(JSON.stringify({ "errors": [{ "code": "UNAUTHORIZED", "message": "authentication required", "detail": null }] }), {
            status: 401,
            headers: headers,
          });
        } else {
          return upstreamResponse;
        }
      } else {
        return upstreamResponse;
      }
    } else {
      return upstreamResponse;
    }
  },
}

async function justForward(upstreamURL, request) {
  // console.log(`body is ${request.body}; headers are ${request.headers}; method is ${request.method}`)
  const initOptions = {
    headers: request.headers,
    method: request.method
  }
  if (request.method !== 'GET' && request.method !== 'HEAD' && !request.body) {
    initOptions.body = request.body
  }

  return await fetch(upstreamURL, initOptions)
}
