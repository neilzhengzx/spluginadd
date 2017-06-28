#!/usr/bin/env node

const program = require('commander');
const shell = require('shelljs');
const _ = require('lodash');
const pwd = process.cwd();
const fs = require('fs');
const xcode = require('xcode');

function collect(val, memo) {
	memo.push(val);
	return memo;
}

function isReset(v, total) {
	return true;
}

function resetCode(source){
	console.log(' resetCode : ', source);
	shell.exec(`cd ${source} && rm -rf package-lock.json`);
	shell.exec(`cd ${source} && git checkout -- config.json && git checkout -- package.json`);
	shell.exec(`cd ${source} && git checkout -- android/app/src/main/res/values/strings.xml`);
	shell.exec(`cd ${source} && git checkout -- android/gradle.properties`);
	shell.exec(`cd ${source} && git checkout -- android/app/build.gradle`);
	shell.exec(`cd ${source} && git checkout -- android && rm -rf plugin && git checkout -- plugin`);
	shell.exec(`cd ${source} && rm -rf js && git checkout -- js && git checkout -- yarn.lock && git checkout -- package-lock.json`);
	shell.exec(`cd ${source} && rm -rf android/app/src/main &&  git checkout -- android/app/src`);

	shell.exec(`cd ${source} && git checkout -- ios`);

}

program
	.version('1.0.0')
	.usage('[options] <file ...>')
	.description('自动添加插件到RNSmobiler中, 方便调试')
	.option('-a, --add [items]', '添加插件, 支持本地目录, 支持git url地址, 可以通过多次-a来添加多个', collect, [])
	.option('-p, --package <name>', '改变包名')
	.option('-d, --dir <name>', '设定RNSmobiler目录, 默认当前目录下')
	.option('-r, --reset', '重置代码', isReset, false )
	.parse(process.argv);


let RNPath = pwd;
if(program.dir){
	RNPath = program.dir;
}

if(program.reset){
	resetCode(RNPath);
	return ;
}

const startModify = async (source, packagename, resZips,  cb)=>{
	console.log(`开始自动添加插件...`);
	let apiPlugin = `${source}/plugin`;
	let viewPlugin = `${source}/js/components/plugins`;
	let projectPath = source + '/ios/RNSmobiler.xcodeproj/project.pbxproj';

	let views = [];
	let apis = [];

	// 插件安装, js文件部署
	for (let res of resZips) {
		const { path, option } = res;
		try {
			let packageJson = require(path + '/package.json');
			let pluginName = packageJson.name;
			let ios_resources = packageJson.ios_resources;
			let ios_frameworks = packageJson.ios_frameworks;
			let jsFilePath = path + '/__lib__';
			let isView = fs.existsSync(jsFilePath);

			console.log(`添加插件: ${pluginName} ...`);
			if(packagename){
				//修改插件中的包名
				shell.exec(`gsed -i "s/com.rnsmobiler/${packagename}/g" \`grep -rl "com.rnsmobiler" ${path}/android/src/\``, { silent: true });
			}



			if ( (_.isArray(ios_resources) || _.isArray(ios_frameworks))) {
				let myProj = xcode.project(projectPath);

				myProj.parseSync();

				let variantGroup = {};

				for (let res of ios_resources) {
					let r = `${path}/ios/${res}`;
					if (!fs.existsSync(r)) {
						throw `插件${pluginName} 中 ${res}文件不存在`;
					};
					if (res.indexOf('.lproj') != -1) {
						let name = res.substring(res.lastIndexOf('/') + 1);
						let infoPlistVarGp = variantGroup[name] ? variantGroup[name] : myProj.addLocalizationVariantGroup(name);
						if (!variantGroup[name]) variantGroup[name] = infoPlistVarGp;
						myProj.addResourceFile(r, { variantGroup: true }, infoPlistVarGp.fileRef);
					} else {
						myProj.addResourceFile(r);
					}
				}

				fs.writeFileSync(projectPath, myProj.writeSync());

				for (let lib of ios_frameworks) {
					if (typeof lib == 'string') {
						myProj.addFramework(lib);
					} else {
						const { framework, opt } = lib;
						if (framework && opt) {
							let file = `${path}/ios/${framework}`
							if (!fs.existsSync(file)) {
								throw `插件${pluginName} 中 ${framework}文件不存在`;
							};
							myProj.addFramework(file, opt);
						}
					}
				}


				fs.writeFileSync(projectPath, myProj.writeSync());
			}

			if (isView) {
				let files = fs.readdirSync(jsFilePath);
				if (files.length == 0) return '请包涵至少一个控件';

				for (let name of files) {
					views.push(name.substring(0, name.length - '.js'.length));
				}

				//复制js代码到对应目录
				shell.exec(`cp ${jsFilePath}/* ${viewPlugin}/`);
			} else {
				apis.push(pluginName);
			}

			let didPath = `${source}/node_modules/${pluginName}`;
			shell.exec(`rm -rf ${didPath}`);

			let linkTimeout = null;
			let result = await new Promise((resolve, reject) => {
				shell.exec(`cd ${source} && npm install ${path} `, { silent: false }, (code, stdout, stderr) => {
					if (code != 0) {
						reject(stderr);
					} else {
						console.log(stdout);
						shell.exec(`cd ${source} && react-native link ${pluginName}`, { async: true }, (code, stdout, stderr) => {
							console.log(`react-native link ${pluginName} end`);
							resolve();
						});

						// console.log(`packageJson.rnpm = ${JSON.stringify(packageJson.rnpm)}`)

						if (!(packageJson.rnpm && packageJson.rnpm.commands)) {
							linkTimeout = setTimeout(() => {
								console.log(`${pluginName} link timieout`);
								linkTimeout = null;
								resolve();

							}, 60000);
						}

					}
				});
			});
			if (linkTimeout) {
				clearTimeout(linkTimeout);
			}

			if (result) {
				cb(result);
				return;
			}

		} catch (e) {
			console.error(e.message);
			return cb(e.message);
		}
	}

	//生成需要调度的js文件
	if (views.length > 0) {
		let importss = '';
		let exportss = '';
		for (let view of views) {
			importss += `import { default as ${view} } from './${view}'\n`;
			exportss += `\t${view}:${view},\n`;
		}
		let content = `${importss}
export default plugins = {
${exportss}
}
                `;
		try {
			fs.writeFileSync(`${viewPlugin}/index.js`, content);
		} catch (e) {
			console.error(e.message);
			return cb(e.message);
		}
	}

	if (apis.length > 0) {
		let importss = '';
		let exportss = '';
		for (let api of apis) {
			let module = api.substring('react-native-'.length).replace('-', '_');
			importss += `import { default as ${module} } from '${api}'\n`;
			exportss += `\t${module}:${module},\n`;
		}
		let content = `${importss}
                export default plugins = {
                ${exportss}
                }
                `;
		try {
			fs.writeFileSync(`${apiPlugin}/api.js`, content);
		} catch (e) {
			console.error(e.message);
			return cb(e.message);
		}
	}

	if(packagename){
		//修改ios的包名
		shell.exec(`gsed -i "s/com.smobiler.rn/${packagename}/g" ${source}/ios/RNSmobiler.xcodeproj/project.pbxproj`, { silent: true });

		//修改android的包名
		shell.exec(`gsed -i "s/com.rnsmobiler/${packagename}/g" \`grep -rl "com.rnsmobiler" ${source}/android/app/\` && gsed -i "s/com.rnsmobiler/${packagename}/g" ${source}/android/app/build.gradle`, { silent: true });
	}

	return cb();
};

const packageJson = require(`${RNPath}/package.json`);

if(packageJson && packageJson.name == `RNSmobiler`){
	let resZips = [];

	if(program.add.length > 0){
		for(let plugin of program.add){
			let path = plugin;
			if(plugin.startsWith('http://') || plugin.startsWith('https://') || plugin.startsWith('git@')){
				// 先clone
				let clonePath = `${RNPath}/plugin/${new Date().getTime()}`;
				let code = shell.exec(`git clone ${plugin} ${clonePath}`).code;
				if(code != 0){
					console.log(`${plugin} clone error`);
					resetCode(RNPath);
					resZips = [];
					break;
				} else {
					path = clonePath;
				}
			} else {
				if(!fs.existsSync(path)){
					console.log(`${plugin} 目录不存在, 不能添加`);
					resetCode(RNPath);
					resZips = [];
					break;
				}
			}

			resZips.push({
				path, option:{}
			});
		}

		if(resZips.length > 0){
			startModify(RNPath, program.package, resZips, (err)=>{
				if(err){
					resetCode(RNPath);
					console.log('失败....');
				} else {
					console.log('成功....');
				}
			});
		} else{
			console.log('没有合适插件, 退出...');
		}
	} else if(program.package){
		let source = RNPath;
		let packagename = program.package;
		//修改ios的包名
		shell.exec(`gsed -i "s/com.smobiler.rn/${packagename}/g" ${source}/ios/RNSmobiler.xcodeproj/project.pbxproj`, { silent: true });

		//修改android的包名
		shell.exec(`gsed -i "s/com.rnsmobiler/${packagename}/g" \`grep -rl "com.rnsmobiler" ${source}/android/app/\` && gsed -i "s/com.rnsmobiler/${packagename}/g" ${source}/android/app/build.gradle`, { silent: true });
	}
} else {
	console.log(`${RNPath} 不是一个 RNSmobiler 目录`);
}



