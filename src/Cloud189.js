require("dotenv").config();
const recording = require("log4js/lib/appenders/recording");
const { CloudClient, FileTokenStore } = require("../sdk/index");
let { push } = require("./push");

const { logger } = require("./logger");

// 新增：全局变量统计有效签到账号数
let validSignAccounts = 0;
// 新增：全局变量统计总账号数
let totalAccounts = 0;
// 新增：记录无效家庭ID的账号
let invalidFamilyAccounts = [];

const sleep = async (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const mask = (s, start, end) => {
  if (s == null) process.exit(0);
  return s.split("").fill("*", start, end).join("");
};

let timeout = 10000;

const doTask = async (cloudClient, PRIVATE_THREADX, FAMILY_THREADX, userName) => {
  let result = [];
  let signPromises1 = [];
  let getSpace = [`${firstSpace}签到个人云获得(M)`];

  // 个人云签到逻辑
  for (let m = 0; m < PRIVATE_THREADX; m++) {
    signPromises1.push(
      (async () => {
        try {
          const res1 = await cloudClient.userSign();
          if (!res1.isSign) {
            getSpace.push(` ${res1.netdiskBonus}`);
          }
        } catch (e) {}
      })()
    );
  }
  //超时中断
  await Promise.race([Promise.all(signPromises1), sleep(timeout)]);
  if (getSpace.length == 1) getSpace.push(" 0");
  result.push(getSpace.join(""));

  // 家庭云签到逻辑
  signPromises1 = [];
  getSpace = [`${firstSpace}获得(M)`];
  const { familyInfoResp } = await cloudClient.getFamilyList();
  if (familyInfoResp) {
    const family = familyInfoResp.find((f) => f.familyId == FAMILY_ID);
    if (!family) {
      invalidFamilyAccounts.push(userName);  // 新增：记录无效家庭ID的账号
      return result;
    }
    result.push(`${firstSpace}开始签到家庭云 ID: ${family.familyId}`);
    for (let i = 0; i < FAMILY_THREADX; i++) {
      signPromises1.push(
        (async () => {
          try {
            const res = await cloudClient.familyUserSign(family.familyId);
            if (!res.signStatus) {
              getSpace.push(` ${res.bonusSpace}`);
              // 新增：当获得容量>0时增加计数器
              if (res.bonusSpace > 0) {
                validSignAccounts++;
              }
            }
          } catch (e) {}
        })()
      );
    }
    //超时中断
    await Promise.race([Promise.all(signPromises1), sleep(timeout)]);
    if (getSpace.length == 1) getSpace.push(" 0");
    result.push(getSpace.join(""));
  } else {
    invalidFamilyAccounts.push(userName);  // 新增：记录没有familyInfoResp的账号
    return result;
  }
  return result;
};

let firstSpace = "  ";

if (process.env.TYYS == null || process.env.TYYS == "") {
  logger.error("没有设置TYYS环境变量");
  process.exit(0);
}

let accounts_group = process.env.TYYS.trim().split("--");
let FAMILY_ID;

let i;

let cloudClientMap = new Map();
let cloudClient = null;
let userNameInfo;

const fs = require("fs");
const path = require("path");

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 使用示例
const folderPath = path.join(__dirname, "../.token");
ensureDirectoryExists(folderPath);

const main = async () => {
  let accounts;

  for (let p = 0; p < accounts_group.length; p++) {
    accounts = accounts_group[p].trim().split(/[\n ]+/);
    totalAccounts += Math.floor((accounts.length - 1) / 2); // 新增：累加总账号数

    let familyCapacitySize, familyCapacitySize2, firstUserName;
    FAMILY_ID = accounts[0];

    // 读取环境变量配置 
    //当currentIndex < THRESHOLD_COUNT时使用Y配置 
    //当currentIndex >= THRESHOLD_COUNT时使用Z配置
    const THRESHOLD_COUNT = process.env.THRESHOLD_COUNT 
      ? parseInt(process.env.THRESHOLD_COUNT) 
      : 1; //前1个账号配置
    const PRIVATE_Y = process.env.PRIVATE_Y 
      ? parseInt(process.env.PRIVATE_Y) 
      : 12;   //前1个账号个人云签12次
    const FAMILY_Y = process.env.FAMILY_Y 
      ? parseInt(process.env.FAMILY_Y) 
      : 1;   //前1个账号家庭云签1次
    const PRIVATE_Z = process.env.PRIVATE_Z 
      ? parseInt(process.env.PRIVATE_Z) 
      : 0;  //其他账号个人云签0次
    const FAMILY_Z = process.env.FAMILY_Z 
      ? parseInt(process.env.FAMILY_Z) 
      : 1;   //其他账号家庭云签1次

    for (i = 1; i < accounts.length; i += 2) {
      const [userName, password] = accounts.slice(i, i + 2);
      const currentIndex = (i - 1) / 2;

      // 动态设置签到次数
      let PRIVATE_THREADX, FAMILY_THREADX;
      if (currentIndex < THRESHOLD_COUNT) {
        PRIVATE_THREADX = PRIVATE_Y;
        FAMILY_THREADX = FAMILY_Y;
      } else {
        PRIVATE_THREADX = PRIVATE_Z;
        FAMILY_THREADX = FAMILY_Z;
      }

      userNameInfo = mask(userName, 3, 7);
      let token = new FileTokenStore(`.token/${userName}.json`);
      try {
        await sleep(2000)
        cloudClient = new CloudClient({
          username: userName,
          password,
          token: token,
        });
      } catch (e) {
        console.error("操作失败:", e.message);// 只记录错误消息
      }

      cloudClientMap.set(userName, cloudClient);
      try {
        logger.log(`${(i - 1) / 2 + 1}.账户 ${userNameInfo} 开始执行`);

        let {
          cloudCapacityInfo: cloudCapacityInfo0,
          familyCapacityInfo: familyCapacityInfo0,
        } = await cloudClient.getUserSizeInfo();

        const result = await doTask(cloudClient, PRIVATE_THREADX, FAMILY_THREADX, userName);
        result.forEach((r) => logger.log(r));

        let {
          cloudCapacityInfo: cloudCapacityInfo2,
          familyCapacityInfo: familyCapacityInfo2,
        } = await cloudClient.getUserSizeInfo();

        if (i == 1) {
          firstUserName = userName;
          familyCapacitySize = familyCapacityInfo0.totalSize;
          familyCapacitySize2 = familyCapacitySize;
        }

        //重新获取主账号的空间信息
        cloudClient = cloudClientMap.get(firstUserName);
        const { familyCapacityInfo } = await cloudClient.getUserSizeInfo();

        logger.log(
          `${firstSpace}实际：个人容量+ ${
            (cloudCapacityInfo2.totalSize - cloudCapacityInfo0.totalSize) / 1024 / 1024
          }M, 家庭容量+ ${
            (familyCapacityInfo.totalSize - familyCapacitySize2) / 1024 / 1024
          }M`
        );
        logger.log(
          `${firstSpace}个人总容量：${(
            cloudCapacityInfo2.totalSize /
            1024 /
            1024 /
            1024
          ).toFixed(2)}G, 家庭总容量：${
            (familyCapacityInfo2.totalSize /
            1024 /
            1024 /
            1024
          ).toFixed(2)}G`
        );
        familyCapacitySize2 = familyCapacityInfo.totalSize;
      } catch (e) {
        logger.error(e);
        if (e.code === "ETIMEDOUT") throw e;
      } finally {
        logger.log("");
      }
    }

    // ================ 新增：计算本组平均值 ================
    const accountCount = (accounts.length - 1) / 2;
    const totalMB = (familyCapacitySize2 - familyCapacitySize) / (1024 * 1024);
    const avgMB = totalMB / accountCount;
    logger.log(`家庭容量+${totalMB.toFixed(1)}M  号均：${avgMB.toFixed(1)}M`);
    // =================================================

    userNameInfo = mask(firstUserName, 3, 7);
    const capacityChange = familyCapacitySize2 - familyCapacitySize;
    logger.log(
      `主账号${userNameInfo} 家庭容量+ ${capacityChange / 1024 / 1024}M`
    );

    cloudClient = cloudClientMap.get(firstUserName);
    let {
      cloudCapacityInfo: cloudCapacityInfo2,
      familyCapacityInfo: familyCapacityInfo2,
    } = await cloudClient.getUserSizeInfo();
    logger.log(
      `个人总容量：${(
        cloudCapacityInfo2.totalSize /
        1024 /
        1024 /
        1024
      ).toFixed(2)}G, 家庭总容量：${
        (familyCapacityInfo2.totalSize /
        1024 /
        1024 /
        1024
      ).toFixed(2)}G`
    );
    logger.log("");
  }
  // 新增：输出无效家庭ID的账号列表
  if (invalidFamilyAccounts.length > 0) {
    logger.log(`以下账号没有加入主号家庭:（${invalidFamilyAccounts.length}个）`);
    invalidFamilyAccounts.forEach(account => {
      logger.log(account);
    });
  }
};

(async () => {
  try {
    await main();
  } finally {
    logger.log("\n\n");
    const events = recording.replay();
    let content = events.map((e) => `${e.data.join("")}`).join("  \n");

    // ================ 修改推送内容逻辑 ================
    // 匹配新增的平均容量行
    const avgLine = content.match(/家庭容量\+([\d.]+)M  号均：([\d.]+)M/);
    // 匹配原有主账号汇总
    const summaryBlock = content.match(
      /(主账号)(.*?)(家庭容量\+ \d+M[\s\S]*?个人总容量：\d+\.\d{2}G, 家庭总容量：\d+\.\d{2}G)/
    );

    let pushHeader = "";
    // 添加平均容量信息
    if (avgLine) {
      pushHeader += `家庭容量+${avgLine[1]}M  号均：${avgLine[2]}M\n\n`;
    }
    // 保留原有主账号信息
    if (summaryBlock) {
      const account = summaryBlock[2];
      // 增强处理逻辑
      const cleanAccount = account.replace(/\*/g, '').replace(/\s/g, ''); // 移除所有脱敏星号，去除空格等干扰字符
      const last4Digits = cleanAccount.slice(-4).padStart(4, '0'); // 不足4位补零
      pushHeader += `主账号${last4Digits} ${summaryBlock[3]}\n\n`; // 重构输出格式
    }

    content = pushHeader + content;
    // 修改推送标题，添加有效签到账号数和总账号数
    push(`天翼云盘25报告：${validSignAccounts}/${totalAccounts}`, content);
    // ==============================================
  }
})();
