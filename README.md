# 项目简介
基于 Cloudflare的worker + 微信插件ClawBot 的邮件转发bot

# 原理原理
1.把常用的邮箱收到的信件转发到cf的域名邮箱
2.通过cf的邮件路由worker把收到的邮件通过api发到本项目的worker上
3.由本项目worker对邮件进行解析并通过微信插件ClawBot发送到微信实现提醒

# 使用教程
1. 首次使用或者token时效时使用`npm run login`登录
2. context_token失效时使用`npm run query`进行长轮询等待用户侧发一个消息获取context_token
3. 从`.weixin-token.json`和`.weixin-msg.json`拿到必要信息
4. 通过请求cloudflare的worker暴露出来的接口 `/api/config` 更新微信配置信息
5. 新建一个邮件路由规则worker, 把woker接收到的邮件原文(message.raw)请求到`/api/email`

# 接口文档
注意: 所有接口调用都需要带上token, 首次使用可以通过无token调用`/api/token/refresh`进行刷新获取
### /api/config
```
{
    "wxClowbotBaseUrl": "https://ilinkai.weixin.qq.com",
    "wxClowbotChannelVersion": "1.0.2",
    "wxClowbotToken": "xxx@im.bot:xxx",
    "wxClowbotUserId": "xxx@im.wechat",
    "wxClowbotContextToken": "xxx"
  }
```

### /api/token/refresh
更新token

### /api/email
``` body格式text或者raw
邮件路由规则worker获取到的raw直接丢进来即可
```
